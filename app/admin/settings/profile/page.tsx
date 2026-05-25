"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useTheme } from "@/components/theme/ThemeProvider";
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
  if (!opt) return { label: `Desconhecido (+${ddi})`, code: ddi, pretty: `🌍 +${ddi}` };
  return { label: `${opt.label} (+${opt.code})`, code: opt.code, pretty: `${opt.flag} ${opt.label} (+${opt.code})` };
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
  return d;
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
// COMPONENTES UI
// ============================================================================

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">{children}</label>;
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed read-only:opacity-70 read-only:cursor-pointer ${className}`}
    />
  );
}

// ============================================================================
// TIPOS E LÓGICA DE SAÚDE
// ============================================================================
type HealthRecord = {
  id: string;
  date: string;
  weight: number;
  height: number;
  imc: number;
};

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
  
  // Configurações do perfil
  const [name, setName] = useState("");
  const [phoneRaw, setPhoneRaw] = useState("");
  const [phonePrettyPrefix, setPhonePrettyPrefix] = useState("🇧🇷 Brasil (+55)");
  const [whatsappUsername, setWhatsappUsername] = useState("");
  const [waUserTouched, setWaUserTouched] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");

  // Métricas de Saúde (Histórico)
  const [healthHistory, setHealthHistory] = useState<HealthRecord[]>([]);
  const [showHealthForm, setShowHealthForm] = useState(false);
  const [newHealthEntry, setNewHealthEntry] = useState({ date: new Date().toISOString().split("T")[0], weight: "", height: "" });

  const [whatsappSessions, setWhatsappSessions] = useState(1);

  // Estados do WhatsApp VM (Sessão 1)
  const [waLoading, setWaLoading] = useState(false);
  const [waReconnecting, setWaReconnecting] = useState(false);
  const [waConnected, setWaConnected] = useState<boolean>(false);
  const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);
  const [waLastError, setWaLastError] = useState<string | null>(null);
  const [waIsDormant, setWaIsDormant] = useState(true);
  
  const [showWa1Settings, setShowWa1Settings] = useState(false);
  const [waRejectCalls, setWaRejectCalls] = useState<boolean>(true);
  const [waRejectMessage, setWaRejectMessage] = useState<string>("{saudacao}! 😊\nNo momento não estou recebendo ligações. Por favor, envie mensagem e aguarde retorno.");
  const [waAllowedNumbers, setWaAllowedNumbers] = useState("");
  const [waSavingConfig, setWaSavingConfig] = useState(false);

  const [waPushName, setWaPushName] = useState<string | null>(null);
  const [waProfilePicUrl, setWaProfilePicUrl] = useState<string | null>(null);
  const waLastProfileFetchRef = useRef<number>(0);
  const [waStatusText, setWaStatusText] = useState<string | null>(null);

  // Estados e Refs para Importações/Exportações
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

        const memberRes = await supabaseBrowser.from("tenant_members").select("tenants(id, name)").eq("user_id", user.id).maybeSingle();
        const member = memberRes.data;
        if (member && member.tenants) {
          const currentT = Array.isArray(member.tenants) ? member.tenants[0] : member.tenants;
          if (currentT) setTenantId(currentT.id || null);
        }

        const { data: profile } = await supabaseBrowser.from("profiles").select("*").eq("id", user.id).maybeSingle();
        if (profile) {
          setName(profile.display_name || "");
          setWhatsappUsername(profile.whatsapp_username || "");
          setWhatsappSessions(profile.whatsapp_sessions || 1);
          setBirthDate(profile.birth_date || "");
          setGender(profile.gender || "");
          
          if (profile.health_history) {
            setHealthHistory(profile.health_history);
            if (profile.health_history.length > 0) {
              const lastHeight = profile.health_history[profile.health_history.length - 1].height;
              setNewHealthEntry(prev => ({ ...prev, height: String(lastHeight) }));
            }
          }
          
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
      const res = await fetch("/api/whatsapp/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: digits }) });
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
      // Nota: Certifique-se de que as colunas 'birth_date', 'gender' e 'health_history' existam no Supabase ou use metadata
      const { error: profileError } = await supabaseBrowser
        .from("profiles")
        .upsert({
          id: userId,
          display_name: name,
          phone: norm.e164,
          whatsapp_username: whatsappUsername,
          whatsapp_sessions: whatsappSessions,
          birth_date: birthDate,
          gender: gender,
          health_history: healthHistory,
          updated_at: new Date().toISOString()
        });

      if (profileError) throw profileError;
      await supabaseBrowser.auth.updateUser({ data: { full_name: name } });
      
      addToast("success", "Perfil atualizado", "Suas informações foram sincronizadas com o banco.");
      setIsEditing(false);
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSaving(false);
    }
  }

  // --- LÓGICA DE SAÚDE ---
  function handleAddHealthEntry() {
    const w = parseFloat(newHealthEntry.weight);
    const h = parseFloat(newHealthEntry.height);
    if (!w || !h || !newHealthEntry.date) {
      addToast("error", "Erro", "Preencha data, peso e altura válidos.");
      return;
    }
    const imc = parseFloat((w / (h * h)).toFixed(1));
    const newRecord: HealthRecord = {
      id: Date.now().toString(),
      date: newHealthEntry.date,
      weight: w,
      height: h,
      imc
    };
    
    setHealthHistory(prev => {
      const updated = [...prev, newRecord].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      return updated;
    });
    setNewHealthEntry(prev => ({ ...prev, weight: "" })); // Mantém a altura para não precisar redigitar
    setShowHealthForm(false);
    if(!isEditing) setIsEditing(true); // Marca que tem edições para salvar
  }

  function handleDeleteHealthRecord(id: string) {
    setHealthHistory(prev => prev.filter(r => r.id !== id));
    if(!isEditing) setIsEditing(true);
  }

  const sortedHistory = [...healthHistory].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Mais recentes no topo

  const chartData = useMemo(() => {
    if (healthHistory.length === 0) return [];
    // Pega as 10 mais importantes: A mais velha + as 9 mais recentes
    const chronologic = [...healthHistory].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (chronologic.length <= 10) return chronologic;
    const oldest = chronologic[0];
    const latestNine = chronologic.slice(-9);
    return [oldest, ...latestNine];
  }, [healthHistory]);

  const getImcLabel = (imc: number) => {
    if (imc < 18.5) return "Abaixo do peso";
    if (imc < 25) return "Peso Ideal";
    if (imc < 30) return "Sobrepeso";
    return "Obesidade";
  };
  const getImcColor = (imc: number) => {
    if (imc < 18.5) return "text-amber-500";
    if (imc < 25) return "text-emerald-500";
    if (imc < 30) return "text-amber-500";
    return "text-rose-500";
  };


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
      if (res.ok) {
        addToast("success", "Configuração salva", "Regras de bloqueio atualizadas.");
        setShowWa1Settings(false);
      }
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
        if(showVisualLoading) addToast("success", "Sincronizado com sucesso", "Painel atualizado.");
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

  // --- FUNÇÕES DE IMPORTAÇÃO/EXPORTAÇÃO (MANTIDAS INTACTAS) ---
  // ... Todas as funções de export e import mantidas como você enviou
  async function handleExportApps() { if (!tenantId) return; setExporting(true); try { const res = await fetch(`/api/import_export/aplicativo/export?tenant_id=${encodeURIComponent(tenantId)}`); const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `aplicativos_export.xlsx`; a.click(); } catch {} finally { setExporting(false); } }
  function handleDownloadTemplateApps() { window.location.href = "/api/import_export/aplicativo/template"; }
  async function handleImportAppsFile(file: File) { if (!tenantId) return; setImportingApps(true); setActionModal(null); try { const fd = new FormData(); fd.append("file", file); const { data: sess } = await supabaseBrowser.auth.getSession(); await fetch(`/api/import_export/aplicativo/import?tenant_id=${encodeURIComponent(tenantId)}`, { method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) } }); addToast("success", "Importado com sucesso"); } catch {} finally { setImportingApps(false); } }
  async function handleExportServers() { if (!tenantId) return; setExporting(true); try { const res = await fetch(`/api/import_export/servidor/export?tenant_id=${encodeURIComponent(tenantId)}`); const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `servidores_export.xlsx`; a.click(); } catch {} finally { setExporting(false); } }
  function handleDownloadTemplateServers() { window.location.href = "/api/import_export/servidor/template"; }
  async function handleImportServerFile(file: File) { if (!tenantId) return; setImportingServer(true); setActionModal(null); try { const fd = new FormData(); fd.append("file", file); const { data: sess } = await supabaseBrowser.auth.getSession(); await fetch(`/api/import_export/servidor/import?tenant_id=${encodeURIComponent(tenantId)}`, { method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) } }); addToast("success", "Importado"); } catch {} finally { setImportingServer(false); } }
  async function handleExportFinanceiro(years: number[], status: string) { if (!tenantId) return; setShowFinanceiroExportModal(false); setExporting(true); try { const params = new URLSearchParams({ tenant_id: tenantId }); if (years.length > 0) params.set("years", years.join(",")); if (status !== "todos") params.set("status", status); const res = await fetch(`/api/import_export/financeiro/export?${params.toString()}`); const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `financeiro_export.xlsx`; a.click(); } catch {} finally { setExporting(false); } }
  function handleDownloadTemplateFinanceiro() { window.location.href = "/api/import_export/financeiro/template"; }
  async function handleImportFinanceiroFile(file: File) { if (!tenantId) return; setImportingFinanceiro(true); setActionModal(null); try { const fd = new FormData(); fd.append("file", file); const { data: sess } = await supabaseBrowser.auth.getSession(); await fetch(`/api/import_export/financeiro/import?tenant_id=${encodeURIComponent(tenantId)}`, { method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) } }); addToast("success", "Importado"); } catch {} finally { setImportingFinanceiro(false); } }
  async function handleExportAuto() { if (!tenantId) return; setExporting(true); try { const res = await fetch(`/api/import_export/cobranca/export?tenant_id=${encodeURIComponent(tenantId)}`); const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `automacoes_export.xlsx`; a.click(); } catch {} finally { setExporting(false); } }
  function handleDownloadTemplateAuto() { window.location.href = "/api/import_export/cobranca/template"; }
  async function handleImportAutoFile(file: File) { if (!tenantId) return; setImportingAuto(true); setActionModal(null); try { const fd = new FormData(); fd.append("file", file); const { data: sess } = await supabaseBrowser.auth.getSession(); await fetch(`/api/import_export/cobranca/import?tenant_id=${encodeURIComponent(tenantId)}`, { method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) } }); addToast("success", "Importado"); } catch {} finally { setImportingAuto(false); } }
  async function handleExportResellers() { if (!tenantId) return; setExporting(true); try { const res = await fetch(`/api/import_export/revenda/export?tenant_id=${encodeURIComponent(tenantId)}`); const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `revendas_export.xlsx`; a.click(); } catch {} finally { setExporting(false); } }
  function handleDownloadTemplateResellers() { window.location.href = "/api/import_export/revenda/template"; }
  async function handleImportResellerFile(file: File) { if (!tenantId) return; setImportingReseller(true); setActionModal(null); try { const fd = new FormData(); fd.append("file", file); const { data: sess } = await supabaseBrowser.auth.getSession(); await fetch(`/api/import_export/revenda/import?tenant_id=${encodeURIComponent(tenantId)}`, { method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) } }); addToast("success", "Importado"); } catch {} finally { setImportingReseller(false); } }
  async function handleExportMessages() { if (!tenantId) return; setExporting(true); try { const res = await fetch(`/api/import_export/mensagem/export?tenant_id=${encodeURIComponent(tenantId)}`); const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `mensagens_export.xlsx`; a.click(); } catch {} finally { setExporting(false); } }
  function handleDownloadTemplateMessages() { window.location.href = "/api/import_export/mensagem/template"; }
  async function handleImportMessageFile(file: File) { if (!tenantId) return; setImportingMessage(true); setActionModal(null); try { const fd = new FormData(); fd.append("file", file); const { data: sess } = await supabaseBrowser.auth.getSession(); await fetch(`/api/import_export/mensagem/import?tenant_id=${encodeURIComponent(tenantId)}`, { method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) } }); addToast("success", "Importado"); } catch {} finally { setImportingMessage(false); } }
  async function handleExportClients() { if (!tenantId) return; setExporting(true); try { const res = await fetch(`/api/import_export/cliente/export?tenant_id=${encodeURIComponent(tenantId)}`); const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `clientes_export.xlsx`; a.click(); } catch {} finally { setExporting(false); } }
  function handleDownloadTemplate() { window.location.href = "/api/import_export/cliente/template"; }
  async function handleImportFile(file: File) { if (!tenantId) return; setImporting(true); try { const fd = new FormData(); fd.append("file", file); const { data: sess } = await supabaseBrowser.auth.getSession(); await fetch(`/api/import_export/cliente/import?tenant_id=${encodeURIComponent(tenantId)}`, { method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) } }); addToast("success", "Clientes Importados"); } catch {} finally { setImporting(false); } }

  const handleResetPassword = async () => {
    const ok = await confirm({
      title: "Redefinir Senha",
      subtitle: `Enviar link de recuperação para ${email}?`,
      tone: "sky",
      confirmText: "Sim, enviar",
      cancelText: "Voltar"
    });
    if (!ok) return;
    try {
      await supabaseBrowser.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/auth/update-password" });
      addToast("success", "Enviado", "Verifique sua caixa de entrada.");
    } catch (e: any) { addToast("error", "Erro", e.message); }
  };

  if (loading) {
    return (
      <div className="p-10 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] border-slate-200 dark:border-white/10 rounded-xl border m-6">
        Carregando painel...
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4 pb-6 px-4 sm:px-6 text-slate-800 dark:text-white">
      <ToastNotifications toasts={toasts} removeToast={removeToast} />

      {/* HEADER DA PÁGINA */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-white/5 pb-4">
        <div className="text-left">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            Configurações da Conta
          </h1>
        </div>
        
        {/* SISTEMA DE ABAS E BOTÃO TEMA */}
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

      {/* GRID PRINCIPAL */}
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-3">
        
        {/* COLUNA ESQUERDA: DADOS PESSOAIS + (ABA SAÚDE OU PLANILHAS) */}
        <div className="space-y-6 xl:col-span-2">
          
          {/* CARD 1: DADOS PESSOAIS (SEMPRE VISÍVEL) */}
          <div className={`bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-6 transition-all ${isEditing ? 'ring-1 ring-emerald-500/20' : ''}`}>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-3">
              <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest">
                Informações de Cadastro
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={handleResetPassword} className="h-8 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 font-bold text-[11px] hover:bg-slate-100 dark:hover:bg-white/10 transition-all flex items-center gap-1.5 shadow-sm">
                  <span className="hidden sm:inline">🔒 Alterar Senha</span>
                  <span className="sm:hidden">🔒 Senha</span>
                </button>
                {!isEditing ? (
                  <button onClick={() => setIsEditing(true)} className="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-all shadow-sm flex items-center gap-1.5">
                    ✏️ Editar
                  </button>
                ) : (
                  <button onClick={handleSave} disabled={saving} className="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-all shadow-sm flex items-center gap-1.5">
                    {saving ? "..." : "💾 Salvar"}
                  </button>
                )}
              </div>
            </div>

            {/* LINHA 1: NOME / EMAIL */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Nome Completo</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" readOnly={!isEditing} onFocus={() => setIsEditing(true)} />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input value={email} disabled className="opacity-70 cursor-not-allowed font-mono text-xs" />
              </div>
            </div>

            {/* LINHA 2: CELULAR / WHATSAPP */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <div>
                <Label>País</Label>
                <div className="h-11 px-3 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl flex items-center text-xs font-bold text-slate-700 dark:text-white truncate">
                  {phonePrettyPrefix || "—"}
                </div>
              </div>
              <div>
                <Label>Telefone Celular</Label>
                <div className="relative">
                  <Input value={phoneRaw} onChange={(e) => setPhoneRaw(e.target.value)} onBlur={handlePhoneDone} onKeyDown={(e) => e.key === 'Enter' && handlePhoneDone()} placeholder="Ex: 21999999999" readOnly={!isEditing} onFocus={() => setIsEditing(true)} className="pr-10" />
                  <button type="button" onClick={handlePhoneDone} disabled={!isEditing} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-500 hover:text-emerald-500 transition-colors flex items-center justify-center font-bold">✓</button>
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
                {/* Validação WhatsApp */}
                {waValidation && (
                  <div className={`mt-1.5 flex items-center gap-1.5 text-[10px] font-bold ${waValidation.loading ? "text-slate-400" : waValidation.exists ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
                    {waValidation.loading ? (
                      <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Checando...</>
                    ) : waValidation.exists ? <>✅ WhatsApp ativo</> : <>❌ Não encontrado no WhatsApp</>}
                  </div>
                )}
              </div>
            </div>

            {/* LINHA 3: NASCIMENTO / SEXO */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Data de Nascimento</Label>
                <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} readOnly={!isEditing} onFocus={() => setIsEditing(true)} />
              </div>
              <div>
                <Label>Sexo Biológico</Label>
                <select 
                  value={gender} 
                  onChange={(e) => setGender(e.target.value)} 
                  disabled={!isEditing} 
                  onFocus={() => setIsEditing(true)}
                  className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Não informado</option>
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                </select>
              </div>
            </div>
          </div>

          {/* CARD 2 DINÂMICO: SAÚDE OU PLANILHAS */}
          {activeTab === "profile" ? (
            <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-3">
                <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest">
                  Avaliações Físicas e Métricas
                </h3>
                <button type="button" onClick={() => setShowHealthForm(v => !v)} className="h-8 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 font-bold text-[11px] hover:bg-slate-100 dark:hover:bg-white/10 transition-all flex items-center gap-1.5 shadow-sm">
                  {showHealthForm ? "Cancelar" : "➕ Nova Avaliação"}
                </button>
              </div>

              {/* FORMULÁRIO DE NOVA AVALIAÇÃO */}
              {showHealthForm && (
                <div className="p-4 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <Label>Data da Medição</Label>
                      <Input type="date" value={newHealthEntry.date} onChange={e => setNewHealthEntry({...newHealthEntry, date: e.target.value})} />
                    </div>
                    <div>
                      <Label>Peso (kg)</Label>
                      <Input type="number" step="0.1" placeholder="Ex: 75.5" value={newHealthEntry.weight} onChange={e => setNewHealthEntry({...newHealthEntry, weight: e.target.value})} />
                    </div>
                    <div>
                      <Label>Altura (m)</Label>
                      <Input type="number" step="0.01" placeholder="Ex: 1.75" value={newHealthEntry.height} onChange={e => setNewHealthEntry({...newHealthEntry, height: e.target.value})} />
                    </div>
                  </div>
                  <button type="button" onClick={handleAddHealthEntry} className="w-full h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors">
                    Adicionar Registro
                  </button>
                </div>
              )}

              {/* LISTAGEM DOS REGISTROS RECENTES */}
              <div className="space-y-3">
                <Label>Histórico de Medições</Label>
                {sortedHistory.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-4 bg-slate-50 dark:bg-white/5 rounded-lg border border-dashed border-slate-200 dark:border-white/10">Nenhuma avaliação registrada ainda.</div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {sortedHistory.map(record => (
                      <div key={record.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl gap-2 font-mono text-xs">
                        <div className="flex gap-4 items-center">
                          <span className="text-slate-500 dark:text-white/50">{new Date(record.date).toLocaleDateString('pt-BR')}</span>
                          <span className="font-bold text-slate-800 dark:text-white">{record.weight} kg</span>
                          <span className="text-slate-500 dark:text-white/50">({record.height}m)</span>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                          <span className={`font-bold ${getImcColor(record.imc)}`}>IMC: {record.imc} <span className="text-[10px] uppercase font-sans">({getImcLabel(record.imc)})</span></span>
                          <button type="button" onClick={() => handleDeleteHealthRecord(record.id)} className="text-rose-500 hover:text-rose-600" title="Excluir">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* GRÁFICO DE EVOLUÇÃO (SVG Puro) */}
              {chartData.length > 1 && (
                <div className="pt-4 border-t border-slate-100 dark:border-white/5 space-y-3">
                  <Label>Quadro de Evolução (Peso x Tempo)</Label>
                  <div className="w-full h-40 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl relative p-4 flex flex-col justify-end">
                    {(() => {
                      const maxW = Math.max(...chartData.map(d => d.weight)) + 2;
                      const minW = Math.min(...chartData.map(d => d.weight)) - 2;
                      const range = maxW - minW;
                      
                      const points = chartData.map((d, i) => {
                        const x = (i / (chartData.length - 1)) * 100; // Porcentagem
                        const y = 100 - (((d.weight - minW) / range) * 100);
                        return { x, y, data: d };
                      });

                      const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');

                      return (
                        <div className="w-full h-full relative">
                          <svg className="w-full h-full overflow-visible" preserveAspectRatio="none">
                            {/* Linha do Gráfico */}
                            <polyline 
                              points={polylinePoints} 
                              fill="none" 
                              stroke="currentColor" 
                              strokeWidth="2" 
                              className="text-emerald-500/50"
                              vectorEffect="non-scaling-stroke"
                            />
                            {/* Pontos de dados */}
                            {points.map((p, i) => (
                              <g key={i}>
                                <circle 
                                  cx={`${p.x}%`} 
                                  cy={`${p.y}%`} 
                                  r="4" 
                                  className={`fill-white dark:fill-[#161b22] stroke-2 ${getImcColor(p.data.imc).replace('text-', 'stroke-')}`} 
                                />
                                {/* Tooltip permanente pros extremos ou hover pros outros */}
                                {(i === 0 || i === points.length - 1) && (
                                  <text 
                                    x={`${p.x}%`} 
                                    y={`${p.y}%`} 
                                    dy="-10" 
                                    textAnchor={i === 0 ? "start" : "end"} 
                                    className="text-[9px] font-bold fill-slate-600 dark:fill-white/70"
                                  >
                                    {p.data.weight}kg
                                  </text>
                                )}
                              </g>
                            ))}
                          </svg>
                          {/* Legendas de Data eixo X */}
                          <div className="absolute -bottom-5 left-0 text-[9px] text-slate-400 font-mono">{new Date(chartData[0].date).toLocaleDateString('pt-BR', {month:'short'})}</div>
                          <div className="absolute -bottom-5 right-0 text-[9px] text-slate-400 font-mono">{new Date(chartData[chartData.length-1].date).toLocaleDateString('pt-BR', {month:'short'})}</div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-6 animate-in fade-in duration-300">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-white">Carregamento em massa</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button type="button" onClick={() => setActionModal("export")} disabled={!tenantId || exporting} className="h-12 px-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 font-bold text-xs text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-2">
                  ⬇️ Exportar Registros
                </button>
                <button type="button" onClick={() => setActionModal("template")} disabled={!tenantId} className="h-12 px-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 font-bold text-xs text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-2">
                  📄 Baixar Templates
                </button>
                <button type="button" onClick={() => setActionModal("import")} disabled={!tenantId || importing || importingApps || importingAuto || importingReseller || importingMessage || importingServer} className="h-12 px-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 font-bold text-xs text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-2">
                  ⬆️ Importar Cargas Novas
                </button>
              </div>

              {/* INPUTS OCULTOS */}
              <input ref={importFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); }} />
              <input ref={importAppsFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportAppsFile(f); }} />
              <input ref={importAutoFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportAutoFile(f); }} />
              <input ref={importResellerFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportResellerFile(f); }} />
              <input ref={importMessageFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportMessageFile(f); }} />
              <input ref={importServerFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportServerFile(f); }} />
              <input ref={importFinanceiroFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFinanceiroFile(f); }} />
            </div>
          )}
        </div>

        {/* COLUNA DIREITA: PAINÉIS DO WHATSAPP (SEMPRE VISÍVEL) */}
        <div className="space-y-6">
          
          {/* PAINEL SESSÃO 1 */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-2">
              <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest">
                WhatsApp — Instância 1
              </h3>
              {whatsappSessions === 1 && (
                <button type="button" onClick={() => { setWhatsappSessions(2); if(!isEditing) setIsEditing(true); }} className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline">
                  + Habilitar 2ª Sessão
                </button>
              )}
            </div>

            {!canPairWhatsApp ? (
              <div className="p-3 rounded-lg bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 text-xs text-center font-bold">Aguardando login estrutural.</div>
            ) : (
              <div className="space-y-4">
                {waIsDormant && !waConnected ? (
                  <button type="button" onClick={() => { setWaIsDormant(false); void refreshWhatsAppPanel(true); }} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-sm transition-all mt-2">
                    {waLoading ? "Gerando..." : "📲 Inicializar QR Code"}
                  </button>
                ) : (
                  <>
                    <div className="relative p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 flex gap-5 items-center">
                      {/* Botoões Topo Direito no Card */}
                      <div className="absolute top-3 right-3 flex items-center gap-1.5">
                        <button type="button" onClick={() => void refreshWhatsAppPanel()} disabled={waLoading} className="w-8 h-8 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-500 hover:text-emerald-600 transition-colors shadow-sm disabled:opacity-50" title="Sincronizar">
                          {waLoading ? (
                            <svg className="animate-spin w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-4.54 4.54"/></svg>
                          )}
                        </button>
                        {waConnected && (
                          <button type="button" onClick={() => setShowWa1Settings(true)} className="w-8 h-8 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors shadow-sm" title="Configurações de Chamada">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                          </button>
                        )}
                      </div>

                      {/* Foto Gigante */}
                      <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-full bg-white dark:bg-[#161b22] border-4 border-slate-100 dark:border-white/5 overflow-hidden flex items-center justify-center shadow-sm">
                        {waProfilePicUrl ? (
                           <img src={waProfilePicUrl} alt="Avatar" className="w-full h-full object-cover" />
                        ) : waQrDataUrl ? (
                           <img src={waQrDataUrl} alt="QR Code" className="w-full h-full object-cover p-1" />
                        ) : (
                           <span className="text-xl font-bold text-slate-300 dark:text-white/20">WA</span>
                        )}
                      </div>

                      {/* Info Detalhada */}
                      <div className="flex-1 min-w-0 flex flex-col gap-1.5 justify-center">
                        <div className="text-[11px] text-slate-500 dark:text-white/50">
                          <span className="font-bold text-slate-800 dark:text-white">Nome:</span> {waPushName || "Aguardando"}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-white/50">
                          <span className="font-bold text-slate-800 dark:text-white">Chamadas:</span> {waRejectCalls ? "Rejeitadas 🚫" : "Permitidas ✅"}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-white/50 flex items-center gap-1 mt-1">
                          <span className="font-bold text-slate-800 dark:text-white">Status:</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${waConnected ? "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400" : "bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400"}`}>
                            {waConnected ? "On-line" : "Off-line"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button type="button" onClick={() => void handleReconnectWhatsApp()} disabled={waReconnecting} className="flex-1 py-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400 font-bold text-xs hover:bg-amber-100 transition-colors shadow-sm">🔄 Reiniciar</button>
                      {waConnected && <button type="button" onClick={() => void handleDisconnectWhatsApp()} className="flex-1 py-2 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 font-bold text-xs hover:bg-rose-100 transition-colors shadow-sm">🔌 Desconectar</button>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* INSTÂNCIA 2 */}
          {whatsappSessions >= 2 && (
            <WhatsAppSession2Panel 
              canPair={canPairWhatsApp} 
              tenantId={tenantId} 
              addToast={addToast} 
              onDisable={() => { setWhatsappSessions(1); if(!isEditing) setIsEditing(true); }}
            />
          )}
        </div>
      </div>

      {/* ============================================================================
          MODALS DE IMPORT/EXPORT (MANTIDOS INTACTOS)
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
                <button key={idx} type="button" onClick={() => { setActionModal(null); item.act(); }} className="w-full text-left text-xs p-3 font-semibold rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-white transition-colors flex items-center gap-2">
                  <span>{item.icon}</span> {item.n}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setActionModal(null)} className="w-full text-center text-xs font-bold text-slate-400 mt-2 hover:text-slate-600 dark:hover:text-white/80">Fechar</button>
          </div>
        </div>
      )}

      {showFinanceiroExportModal && (() => {
        const currentYear = new Date().getFullYear();
        const availableYears = [currentYear - 1, currentYear, currentYear + 1];
        return (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-[#161b22] w-full max-w-sm rounded-xl border border-slate-200 dark:border-white/10 p-6 space-y-4 text-left shadow-xl">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">Filtros de Exportação Financeira</h3>
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">Anos disponíveis</span>
                <div className="flex gap-2">
                  {availableYears.map(y => (
                    <button key={y} type="button" onClick={() => setFinExportYears(prev => prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y])} className={`px-3 py-1.5 text-xs font-bold rounded border transition-colors ${finExportYears.includes(y) ? "border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400" : "border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50"}`}>{y}</button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => void handleExportFinanceiro(finExportYears, finExportStatus)} className="w-full py-2 bg-emerald-600 font-bold rounded-lg text-white text-xs hover:bg-emerald-500 transition-colors">Confirmar e Baixar</button>
              <button type="button" onClick={() => setShowFinanceiroExportModal(false)} className="w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white/80">Cancelar</button>
            </div>
          </div>
        );
      })()}

      {/* ============================================================================
          MODAL EXCLUSIVO DE CONFIGURAÇÕES DE CHAMADA (SESSÃO 1)
         ============================================================================ */}
      {showWa1Settings && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[#161b22] w-full max-w-sm rounded-2xl border border-slate-200 dark:border-white/10 p-6 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Configurações (Instância 1)</h3>
            <p className="text-xs text-slate-500 dark:text-white/50 mb-5">Configure o bloqueio automático de ligações para este número.</p>

            <div className="space-y-5">
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20">
                <span className="text-sm font-bold text-slate-700 dark:text-white">📵 Rejeitar Chamadas</span>
                <button type="button" onClick={() => setWaRejectCalls(v => !v)} className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${waRejectCalls ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"}`}>
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${waRejectCalls ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              {waRejectCalls && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1.5">Mensagem de Resposta</label>
                    {/* Botões de Variáveis */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {["{saudacao}", "{hora}", "{data}"].map(tag => (
                        <button key={tag} type="button" onClick={() => setWaRejectMessage(v => v + tag)} className="text-[10px] px-2 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-slate-600 dark:text-white font-mono transition-colors">
                          {tag}
                        </button>
                      ))}
                    </div>
                    <textarea value={waRejectMessage} onChange={e => setWaRejectMessage(e.target.value)} rows={3} placeholder="Ex: {saudacao}! Não atendo ligações..." className="w-full px-3 py-2 text-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1.5">Números Liberados</label>
                    <textarea value={waAllowedNumbers} onChange={e => setWaAllowedNumbers(e.target.value)} rows={3} placeholder="5521999998888 João" className="w-full px-3 py-2 text-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none font-mono" />
                    <p className="text-[10px] text-slate-400 mt-1">Coloque um número por linha (com DDI). Pode adicionar o nome ao lado para organizar.</p>
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowWa1Settings(false)} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 font-bold text-sm hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                  Cancelar
                </button>
                <button type="button" onClick={() => void saveWaConfig()} disabled={waSavingConfig} className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md transition-transform active:scale-95 disabled:opacity-60">
                  {waSavingConfig ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SESSÃO WHATSAPP 2
// ============================================================================
function WhatsAppSession2Panel({ canPair, tenantId, addToast, onDisable }: { canPair: boolean; tenantId: string | null; addToast: any, onDisable: () => void }) {
  const { confirm } = useConfirm();
  const [waLoading, setWaLoading] = useState(false);
  const [waConnected, setWaConnected] = useState(false);
  const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);
  const [isDormant, setIsDormant] = useState(true);
  const [waPushName, setWaPushName] = useState<string | null>(null);
  const [waProfilePicUrl, setWaProfilePicUrl] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Settings state
  const [showWa2Settings, setShowWa2Settings] = useState(false);
  const [waRejectCalls, setWaRejectCalls] = useState(true);
  const [waRejectMessage, setWaRejectMessage] = useState("{saudacao}! 😊\nNo momento não estou recebendo ligações. Por favor, envie mensagem.");
  const [waAllowedNumbers, setWaAllowedNumbers] = useState("");
  const [waSavingConfig, setWaSavingConfig] = useState(false);

  async function fetchWaConfig() {
    try {
      const res = await fetch("/api/whatsapp/config2", { cache: "no-store" });
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
      const res = await fetch("/api/whatsapp/config2", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectCalls: waRejectCalls, rejectMessage: waRejectMessage, allowedNumbers }),
      });
      if (res.ok) {
        addToast("success", "Salvo", "Regras da Sessão 2 atualizadas.");
        setShowWa2Settings(false);
      }
    } catch (e: any) { addToast("error", "Erro", e.message); } finally { setWaSavingConfig(false); }
  }

  async function fetchWaStatus() {
    try {
      const res = await fetch("/api/whatsapp/status2", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setWaConnected(!!json.connected); 
      return { connected: !!json.connected, status: json.status };
    } catch { return { connected: false, status: "error" }; }
  }

  async function refreshPanel(forceQr = false, showVisualLoading = true) {
    if (showVisualLoading) setWaLoading(true);
    try {
      const { connected, status } = await fetchWaStatus();
      if (connected) { 
        setIsDormant(false); 
        setWaQrDataUrl(null); 
        await fetchWaConfig();
        if(showVisualLoading) addToast("success", "Sincronizado", "Painel da Sessão 2 atualizado.");
        return; 
      }
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
      addToast("success", "Desconectado");
    } catch {} finally { setWaLoading(false); }
  }

  async function handleReconnect() {
    const ok = await confirm({ title: "Reiniciar Instância 2?", subtitle: "Forçar reinicialização.", tone: "amber", confirmText: "Reconectar", cancelText: "Voltar" });
    if (!ok) return; setIsReconnecting(true);
    try {
      await fetch("/api/whatsapp/reconnect2", { method: "POST" });
      setWaConnected(false); setWaQrDataUrl(null); setIsDormant(false);
      setTimeout(() => void refreshPanel(true, false), 4000);
    } catch {} finally { setIsReconnecting(false); }
  }

  return (
    <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-4 animate-in fade-in">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-2">
        <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest">
          WhatsApp — Instância 2
        </h3>
        <button type="button" onClick={onDisable} className="text-[10px] font-bold text-rose-500 hover:underline">
          - Desabilitar Sessão
        </button>
      </div>

      <div className="space-y-4">
        {isDormant && !waConnected ? (
          <button type="button" onClick={() => { setIsDormant(false); void refreshPanel(true); }} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-sm transition-all mt-2">
            {waLoading ? "Gerando..." : "📲 Inicializar QR Code 2"}
          </button>
        ) : (
          <>
            <div className="relative p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 flex gap-5 items-center">
              {/* Botões Topo Direito */}
              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                <button type="button" onClick={() => void refreshPanel()} disabled={waLoading} className="w-8 h-8 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-500 hover:text-emerald-600 transition-colors shadow-sm disabled:opacity-50" title="Sincronizar">
                  {waLoading ? (
                    <svg className="animate-spin w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-4.54 4.54"/></svg>
                  )}
                </button>
                {waConnected && (
                  <button type="button" onClick={() => setShowWa2Settings(true)} className="w-8 h-8 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors shadow-sm" title="Configurações">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                  </button>
                )}
              </div>

              <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-full bg-white dark:bg-[#161b22] border-4 border-slate-100 dark:border-white/5 overflow-hidden flex items-center justify-center shadow-sm">
                {waProfilePicUrl ? (
                   <img src={waProfilePicUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : waQrDataUrl ? (
                   <img src={waQrDataUrl} alt="QR Code" className="w-full h-full object-cover p-1" />
                ) : (
                   <span className="text-xl font-bold text-slate-300 dark:text-white/20">WA</span>
                )}
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-1.5 justify-center">
                <div className="text-[11px] text-slate-500 dark:text-white/50">
                  <span className="font-bold text-slate-800 dark:text-white">Nome:</span> {waPushName || "Aguardando"}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-white/50">
                  <span className="font-bold text-slate-800 dark:text-white">Chamadas:</span> {waRejectCalls ? "Rejeitadas 🚫" : "Permitidas ✅"}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-white/50 flex items-center gap-1 mt-1">
                  <span className="font-bold text-slate-800 dark:text-white">Status:</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${waConnected ? "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400" : "bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400"}`}>
                    {waConnected ? "On-line" : "Off-line"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => void handleReconnect()} disabled={isReconnecting} className="flex-1 py-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400 font-bold text-xs hover:bg-amber-100 transition-colors shadow-sm">🔄 Reiniciar</button>
              {waConnected && <button type="button" onClick={() => void handleDisconnect()} className="flex-1 py-2 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 font-bold text-xs hover:bg-rose-100 transition-colors shadow-sm">🔌 Desligar</button>}
            </div>
          </>
        )}
      </div>

      {/* Modal Settings Wa 2 */}
      {showWa2Settings && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[#161b22] w-full max-w-sm rounded-2xl border border-slate-200 dark:border-white/10 p-6 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Configurações (Instância 2)</h3>
            <p className="text-xs text-slate-500 dark:text-white/50 mb-5">Configure o bloqueio de ligações para a 2ª sessão.</p>

            <div className="space-y-5">
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20">
                <span className="text-sm font-bold text-slate-700 dark:text-white">📵 Rejeitar Chamadas</span>
                <button type="button" onClick={() => setWaRejectCalls(v => !v)} className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${waRejectCalls ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"}`}>
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${waRejectCalls ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              {waRejectCalls && (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1.5">Mensagem de Resposta</label>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {["{saudacao}", "{hora}", "{data}"].map(tag => (
                        <button key={tag} type="button" onClick={() => setWaRejectMessage(v => v + tag)} className="text-[10px] px-2 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-slate-600 dark:text-white font-mono transition-colors">
                          {tag}
                        </button>
                      ))}
                    </div>
                    <textarea value={waRejectMessage} onChange={e => setWaRejectMessage(e.target.value)} rows={3} placeholder="Escreva a mensagem..." className="w-full px-3 py-2 text-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1.5">Números Liberados</label>
                    <textarea value={waAllowedNumbers} onChange={e => setWaAllowedNumbers(e.target.value)} rows={3} placeholder="5521999998888 Nome" className="w-full px-3 py-2 text-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none font-mono" />
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowWa2Settings(false)} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 font-bold text-sm hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                  Cancelar
                </button>
                <button type="button" onClick={() => void saveWaConfig()} disabled={waSavingConfig} className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md transition-transform active:scale-95 disabled:opacity-60">
                  {waSavingConfig ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}