"use client";
import {
  Loader2,
  Pencil,
  Settings,
  RefreshCcw,
  Plug,
  Target,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Ban,
  CheckCircle2,
} from "lucide-react";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, {
  ToastMessage,
} from "@/app/admin/ToastNotifications";
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
  if (!opt)
    return { label: `Desconhecido (+${ddi})`, code: ddi, pretty: `🌍 +${ddi}` };
  return {
    label: `${opt.label} (+${opt.code})`,
    code: opt.code,
    pretty: `${opt.flag} ${opt.label} (+${opt.code})`,
  };
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
  if (!rawDigits)
    return {
      prettyPrefix: "—",
      e164: "",
      formattedNational: "",
      nationalDigits: "",
    };
  let finalInputToInfer = rawInput;
  if (
    !rawInput.trim().startsWith("+") &&
    (rawDigits.length === 10 || rawDigits.length === 11)
  ) {
    finalInputToInfer = `+55${rawDigits}`;
  }
  const ddi = inferDDIFromDigits(
    onlyDigits(finalInputToInfer),
    finalInputToInfer,
  );
  const meta = ddiMeta(ddi);
  const nationalDigits = onlyDigits(finalInputToInfer).startsWith(ddi)
    ? onlyDigits(finalInputToInfer).slice(ddi.length)
    : onlyDigits(finalInputToInfer);
  const formattedNational = formatNational(ddi, nationalDigits);
  return {
    prettyPrefix: meta.pretty,
    e164: `+${ddi}${nationalDigits}`,
    formattedNational,
    nationalDigits,
  };
}

// ============================================================================
// TIPOS: LISTA BRANCA WHATSAPP
// ============================================================================
type AllowedNumberRow = {
  id: string;
  name: string;
  raw: string;
  e164: string;
  loading: boolean;
  exists: boolean | null;
};

function parseAllowedNumbers(arr: string[]): AllowedNumberRow[] {
  return arr.map((entry) => {
    const parts = entry.trim().split(" ");
    const digits = parts[0] || "";
    const name = parts.slice(1).join(" ");
    const norm = applyPhoneNormalization(digits);
    return {
      id: Math.random().toString(36).slice(2),
      name,
      raw: norm.formattedNational || digits,
      e164: norm.e164 || digits,
      loading: false,
      exists: true, // Presumimos true já que veio do banco
    };
  });
}

function stringifyAllowedNumbers(rows: AllowedNumberRow[]): string[] {
  return rows
    .filter((r) => r.raw.trim() !== "")
    .map((r) => {
      const norm = applyPhoneNormalization(r.raw);
      const num = norm.e164 ? onlyDigits(norm.e164) : onlyDigits(r.raw);
      return `${num} ${r.name}`.trim();
    });
}

// ============================================================================
// COMPONENTES UI
// ============================================================================

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-medium text-muted-foreground/80 dark:text-muted-foreground mb-1.5 uppercase tracking-wider">
      {children}
    </label>
  );
}

function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-11 px-3 bg-transparent border border-border rounded-xl text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed read-only:opacity-70 read-only:cursor-pointer ${className}`}
    />
  );
}

type HealthRecord = {
  id: string;
  date: string;
  weight: number;
  imc: number; // calculado com profileHeight
};

// ============================================================================
// PÁGINA PRINCIPAL
// ============================================================================

export default function ProfileSettingsPage() {
  const { theme, setTheme } = useTheme();
  const { confirm } = useConfirm();

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
  const [profileHeight, setProfileHeight] = useState(""); // ex: "1.75"
  const [editingHealthId, setEditingHealthId] = useState<string | null>(null);
  const [hoveredPt, setHoveredPt] = useState<{
    i: number;
    x: number;
    y: number;
  } | null>(null);

  // Métricas de Saúde (Histórico)
  const [healthHistory, setHealthHistory] = useState<HealthRecord[]>([]);
  const [showHealthForm, setShowHealthForm] = useState(false);
  const [showAllHealthRecords, setShowAllHealthRecords] = useState(false); // NOVO: Controla a lista
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false); // NOVO: Controla a engrenagem
  const [newHealthEntry, setNewHealthEntry] = useState({
    date: new Date().toISOString().split("T")[0],
    weight: "",
  });

  const [whatsappSessions, setWhatsappSessions] = useState(1);

  // Estados do WhatsApp VM (Sessão 1)
  const [waLoading, setWaLoading] = useState(false);
  const [waReconnecting, setWaReconnecting] = useState(false);
  const [waConnected, setWaConnected] = useState<boolean>(false);
  const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);

  const [waIsDormant, setWaIsDormant] = useState(true);

  const [showWa1Settings, setShowWa1Settings] = useState(false);
  const [waRejectCalls, setWaRejectCalls] = useState<boolean>(true);
  const [waRejectMessage, setWaRejectMessage] = useState<string>(
    "{saudacao}! 😊\nNo momento não estou recebendo ligações. Por favor, envie mensagem e aguarde retorno.",
  );

  // Nova Tabela de Lista Branca (Sessão 1)
  const [waAllowedList, setWaAllowedList] = useState<AllowedNumberRow[]>([]);
  const [waSavingConfig, setWaSavingConfig] = useState(false);

  const [waPushName, setWaPushName] = useState<string | null>(null);
  const [waProfilePicUrl, setWaProfilePicUrl] = useState<string | null>(null);
  const waLastProfileFetchRef = useRef<number>(0);

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

  const [actionModal, setActionModal] = useState<
    "export" | "template" | "import" | null
  >(null);
  const [showFinanceiroExportModal, setShowFinanceiroExportModal] =
    useState(false);
  const [finExportYears, setFinExportYears] = useState<number[]>([
    new Date().getFullYear(),
  ]);
  const [finExportStatus, setFinExportStatus] = useState<
    "todos" | "PAGO" | "PENDENTE"
  >("todos");

  type WaValidation = {
    loading: boolean;
    exists: boolean;
    jid?: string;
  } | null;
  const [waValidation, setWaValidation] = useState<WaValidation>(null);
  const waValidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const toastSeq = useRef(1);

  const canPairWhatsApp = !!userId && !!tenantId;

  const addToast = (
    type: "success" | "error",
    title: string,
    message?: string,
  ) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    setToasts((prev) => [
      ...prev,
      { id, type, title, message, durationMs: 5000 },
    ]);
  };
  const removeToast = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  // --- CARREGAR DADOS ---
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabaseBrowser.auth.getUser();
        if (!user) return;
        setUserId(user.id);
        setEmail(user.email || "");

        const memberRes = await supabaseBrowser
          .from("tenant_members")
          .select("tenants(id, name)")
          .eq("user_id", user.id)
          .maybeSingle();
        const member = memberRes.data;
        if (member && member.tenants) {
          const currentT = Array.isArray(member.tenants)
            ? member.tenants[0]
            : member.tenants;
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
          setWhatsappSessions(profile.whatsapp_sessions || 1);
          setBirthDate(profile.birth_date || "");
          setGender(profile.gender || "");
          setProfileHeight(profile.height ? String(profile.height) : "");

          if (profile.health_history) {
            setHealthHistory(profile.health_history);
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
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        timer = setTimeout(() => {
          void tick();
        }, 600000);
        return;
      }
      await refreshWhatsAppPanel(false, false);
      timer = setTimeout(
        () => {
          void tick();
        },
        waConnected ? 300000 : 80000,
      );
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [tenantId, canPairWhatsApp, waConnected, waIsDormant]);

  async function validateWa(username: string) {
    const digits = username.replace(/\D/g, "");
    if (digits.length < 8) {
      setWaValidation(null);
      return;
    }
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
        const jidDigits = String(json.jid)
          .split("@")[0]
          .split(":")[0]
          .replace(/\D/g, "");
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
      const finalUser =
        waUserTouched && whatsappUsername.trim()
          ? whatsappUsername.trim()
          : digits;
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
    
  }

  // --- LÓGICA DE SAÚDE ---
  async function handleAddHealthEntry() {
    const w = parseFloat(newHealthEntry.weight);
    if (!w || !newHealthEntry.date) {
      addToast("error", "Erro", "Preencha a data e o peso.");
      return;
    }
    if (!userId) return;
    const h = parseFloat(profileHeight);
    const imc = h > 0 ? parseFloat((w / (h * h)).toFixed(1)) : 0;

    let updatedHistory: HealthRecord[];
    if (editingHealthId) {
      updatedHistory = healthHistory.map((r) =>
        r.id === editingHealthId
          ? { ...r, date: newHealthEntry.date, weight: w, imc }
          : r,
      );
      setEditingHealthId(null);
    } else {
      const newRecord: HealthRecord = {
        id: Date.now().toString(),
        date: newHealthEntry.date,
        weight: w,
        imc,
      };
      updatedHistory = [...healthHistory, newRecord].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
    }

    setHealthHistory(updatedHistory);
    setNewHealthEntry({ date: new Date().toISOString().split("T")[0], weight: "" });
    setShowHealthForm(false);

    setSaving(true);
    try {
      const { error } = await supabaseBrowser
        .from("profiles")
        .upsert({ id: userId, health_history: updatedHistory, updated_at: new Date().toISOString() });
      if (error) throw error;
      addToast("success", "Avaliação salva", "Registro sincronizado com o banco.");
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSaving(false);
    }
  
    try {
      const norm = applyPhoneNormalization(phoneRaw);
      const updatedHistory = editingHealthId
        ? healthHistory.map((r) =>
            r.id === editingHealthId
              ? { ...r, date: newHealthEntry.date, weight: parseFloat(newHealthEntry.weight), imc: parseFloat(profileHeight) > 0 ? parseFloat((parseFloat(newHealthEntry.weight) / (parseFloat(profileHeight) ** 2)).toFixed(1)) : 0 }
              : r,
          )
        : [...healthHistory, { id: Date.now().toString(), date: newHealthEntry.date, weight: parseFloat(newHealthEntry.weight), imc: parseFloat(profileHeight) > 0 ? parseFloat((parseFloat(newHealthEntry.weight) / (parseFloat(profileHeight) ** 2)).toFixed(1)) : 0 }].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const { error } = await supabaseBrowser
        .from("profiles")
        .upsert({ id: userId!, health_history: updatedHistory, updated_at: new Date().toISOString() });
      if (error) throw error;
      addToast("success", "Avaliação salva", "Registro sincronizado com o banco.");
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteHealthRecord(id: string) {
    const ok = await confirm({
      title: "Excluir avaliação?",
      subtitle: "Este registro será removido permanentemente.",
      tone: "rose",
      confirmText: "Excluir",
      cancelText: "Cancelar",
    });
    if (!ok) return;
    setHealthHistory((prev) => prev.filter((r) => r.id !== id));
    if (!isEditing) setIsEditing(true);
    addToast("success", "Registro removido");
  }

  const sortedHistory = [...healthHistory].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const chartData = useMemo(() => {
    if (healthHistory.length === 0) return [];
    const chronologic = [...healthHistory].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
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

  const getImcStrokeColor = (imc: number) => {
    if (imc <= 0) return "#94a3b8";
    if (imc < 18.5) return "#f59e0b";
    if (imc < 25) return "#10b981";
    if (imc < 30) return "#f59e0b";
    return "#f43f5e";
  };

  // --- WHATSAPP CONFIGS VM SESSÃO 1 ---
  async function fetchWaStatus() {
    try {
      const res = await fetch("/api/whatsapp/status", { cache: "no-store" });
      const json = await res.json().catch(() => ({}) as any);
      if (!res.ok) throw new Error(json?.error || "Falha ao consultar status");
      setWaConnected(!!json.connected);

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
        setWaAllowedList(parseAllowedNumbers(json.allowedNumbers ?? []));
      }
    } catch {}
  }

  async function saveWaConfig() {
    setWaSavingConfig(true);
    try {
      const allowedNumbers = stringifyAllowedNumbers(waAllowedList);
      const res = await fetch("/api/whatsapp/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rejectCalls: waRejectCalls,
          rejectMessage: waRejectMessage,
          allowedNumbers,
        }),
      });
      if (res.ok) {
        addToast(
          "success",
          "Configuração salva",
          "Regras de bloqueio atualizadas.",
        );
        setShowWa1Settings(false);
      }
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setWaSavingConfig(false);
    }
  }

  // Validação dinâmica por linha da lista
  async function validateWaRow(id: string, currentRaw: string) {
    const digits = onlyDigits(currentRaw);
    if (digits.length < 8) {
      setWaAllowedList((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, loading: false, exists: false } : r,
        ),
      );
      return;
    }
    setWaAllowedList((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, loading: true, exists: null } : r,
      ),
    );
    try {
      const res = await fetch("/api/whatsapp/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const json = await res.json().catch(() => ({}));
      let updatedRaw = currentRaw;
      let updatedE164 = "";
      if (json.exists && json.jid) {
        const jidDigits = String(json.jid)
          .split("@")[0]
          .split(":")[0]
          .replace(/\D/g, "");
        const norm = applyPhoneNormalization(jidDigits);
        updatedRaw = norm.formattedNational || currentRaw;
        updatedE164 = norm.e164;
      }
      setWaAllowedList((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                loading: false,
                exists: !!json.exists,
                raw: updatedRaw,
                e164: updatedE164,
              }
            : r,
        ),
      );
    } catch {
      setWaAllowedList((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, loading: false, exists: false } : r,
        ),
      );
    }
  }

  async function fetchWaQr() {
    try {
      const res = await fetch("/api/whatsapp/qr", { cache: "no-store" });
      const json = await res.json().catch(() => ({}) as any);
      return json.qr || null;
    } catch {
      return null;
    }
  }

  async function fetchWaProfile() {
    try {
      const res = await fetch("/api/whatsapp/profile", { cache: "no-store" });
      const json = await res.json().catch(() => ({}) as any);
      setWaPushName(json.pushName ?? null);
      setWaProfilePicUrl(json.pictureUrl ?? null);
    } catch {}
  }

  async function refreshWhatsAppPanel(
    forceQr = false,
    showVisualLoading = true,
  ) {
    if (showVisualLoading) setWaLoading(true);
    try {
      const { connected, status } = await fetchWaStatus();
      if (connected) {
        setWaIsDormant(false);
        setWaQrDataUrl(null);
        const now = Date.now();
        if (
          !waPushName ||
          !waProfilePicUrl ||
          now - waLastProfileFetchRef.current > 86400000
        ) {
          await fetchWaProfile();
          await fetchWaConfig();
          waLastProfileFetchRef.current = now;
        }
        if (showVisualLoading)
          addToast("success", "Sincronizado com sucesso", "Painel atualizado.");
        return;
      }
      if (forceQr || status === "qr" || status === "connecting") {
        const qr = await fetchWaQr();
        setWaQrDataUrl(qr);
      } else {
        setWaQrDataUrl(null);
      }
      if (showVisualLoading)
        addToast("success", "Sincronizado", "Instância 1 offline.");
    } finally {
      if (showVisualLoading) setWaLoading(false);
    }
  }

  async function handleDisconnectWhatsApp() {
    const ok = await confirm({
      title: "Desconectar?",
      subtitle: "Sessão 1 será encerrada.",
      tone: "rose",
      confirmText: "Desconectar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setWaLoading(true);
    try {
      await fetch("/api/whatsapp/disconnect", {
        method: "POST",
        cache: "no-store",
      });
      setWaConnected(false);
      setWaQrDataUrl(null);
      setWaPushName(null);
      setWaProfilePicUrl(null);
      setWaIsDormant(true);
      addToast("success", "Desconectado");
    } catch {
    } finally {
      setWaLoading(false);
    }
  }

  async function handleReconnectWhatsApp() {
    const ok = await confirm({
      title: "Forçar reconexão?",
      subtitle: "A sessão 1 será reiniciada.",
      tone: "amber",
      confirmText: "Reconectar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setWaReconnecting(true);
    try {
      await fetch("/api/whatsapp/reconnect", {
        method: "POST",
        cache: "no-store",
      });
      setWaConnected(false);
      setWaQrDataUrl(null);
      setWaIsDormant(false);
      setTimeout(() => void refreshWhatsAppPanel(true, false), 4000);
    } catch {
    } finally {
      setWaReconnecting(false);
    }
  }

  // --- FUNÇÕES DE IMPORTAÇÃO/EXPORTAÇÃO ---
  async function handleExportApps() {
    if (!tenantId) return;
    setExporting(true);
    try {
      const res = await fetch(
        `/api/import_export/aplicativo/export?tenant_id=${encodeURIComponent(tenantId)}`,
      );
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aplicativos_export.xlsx`;
      a.click();
    } catch {
    } finally {
      setExporting(false);
    }
  }
  function handleDownloadTemplateApps() {
    window.location.href = "/api/import_export/aplicativo/template";
  }
  async function handleImportAppsFile(file: File) {
    if (!tenantId) return;
    setImportingApps(true);
    setActionModal(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(
        `/api/import_export/aplicativo/import?tenant_id=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          body: fd,
          headers: {
            ...(sess?.session?.access_token
              ? { Authorization: `Bearer ${sess.session.access_token}` }
              : {}),
          },
        },
      );
      addToast("success", "Importado com sucesso");
    } catch {
    } finally {
      setImportingApps(false);
    }
  }
  async function handleExportServers() {
    if (!tenantId) return;
    setExporting(true);
    try {
      const res = await fetch(
        `/api/import_export/servidor/export?tenant_id=${encodeURIComponent(tenantId)}`,
      );
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `servidores_export.xlsx`;
      a.click();
    } catch {
    } finally {
      setExporting(false);
    }
  }
  function handleDownloadTemplateServers() {
    window.location.href = "/api/import_export/servidor/template";
  }
  async function handleImportServerFile(file: File) {
    if (!tenantId) return;
    setImportingServer(true);
    setActionModal(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(
        `/api/import_export/servidor/import?tenant_id=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          body: fd,
          headers: {
            ...(sess?.session?.access_token
              ? { Authorization: `Bearer ${sess.session.access_token}` }
              : {}),
          },
        },
      );
      addToast("success", "Importado");
    } catch {
    } finally {
      setImportingServer(false);
    }
  }
  async function handleExportFinanceiro(years: number[], status: string) {
    if (!tenantId) return;
    setShowFinanceiroExportModal(false);
    setExporting(true);
    try {
      const params = new URLSearchParams({ tenant_id: tenantId });
      if (years.length > 0) params.set("years", years.join(","));
      if (status !== "todos") params.set("status", status);
      const res = await fetch(
        `/api/import_export/financeiro/export?${params.toString()}`,
      );
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `financeiro_export.xlsx`;
      a.click();
    } catch {
    } finally {
      setExporting(false);
    }
  }
  function handleDownloadTemplateFinanceiro() {
    window.location.href = "/api/import_export/financeiro/template";
  }
  async function handleImportFinanceiroFile(file: File) {
    if (!tenantId) return;
    setImportingFinanceiro(true);
    setActionModal(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(
        `/api/import_export/financeiro/import?tenant_id=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          body: fd,
          headers: {
            ...(sess?.session?.access_token
              ? { Authorization: `Bearer ${sess.session.access_token}` }
              : {}),
          },
        },
      );
      addToast("success", "Importado");
    } catch {
    } finally {
      setImportingFinanceiro(false);
    }
  }
  async function handleExportAuto() {
    if (!tenantId) return;
    setExporting(true);
    try {
      const res = await fetch(
        `/api/import_export/cobranca/export?tenant_id=${encodeURIComponent(tenantId)}`,
      );
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `automacoes_export.xlsx`;
      a.click();
    } catch {
    } finally {
      setExporting(false);
    }
  }
  function handleDownloadTemplateAuto() {
    window.location.href = "/api/import_export/cobranca/template";
  }
  async function handleImportAutoFile(file: File) {
    if (!tenantId) return;
    setImportingAuto(true);
    setActionModal(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(
        `/api/import_export/cobranca/import?tenant_id=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          body: fd,
          headers: {
            ...(sess?.session?.access_token
              ? { Authorization: `Bearer ${sess.session.access_token}` }
              : {}),
          },
        },
      );
      addToast("success", "Importado");
    } catch {
    } finally {
      setImportingAuto(false);
    }
  }
  async function handleExportResellers() {
    if (!tenantId) return;
    setExporting(true);
    try {
      const res = await fetch(
        `/api/import_export/revenda/export?tenant_id=${encodeURIComponent(tenantId)}`,
      );
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `revendas_export.xlsx`;
      a.click();
    } catch {
    } finally {
      setExporting(false);
    }
  }
  function handleDownloadTemplateResellers() {
    window.location.href = "/api/import_export/revenda/template";
  }
  async function handleImportResellerFile(file: File) {
    if (!tenantId) return;
    setImportingReseller(true);
    setActionModal(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(
        `/api/import_export/revenda/import?tenant_id=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          body: fd,
          headers: {
            ...(sess?.session?.access_token
              ? { Authorization: `Bearer ${sess.session.access_token}` }
              : {}),
          },
        },
      );
      addToast("success", "Importado");
    } catch {
    } finally {
      setImportingReseller(false);
    }
  }
  async function handleExportMessages() {
    if (!tenantId) return;
    setExporting(true);
    try {
      const res = await fetch(
        `/api/import_export/mensagem/export?tenant_id=${encodeURIComponent(tenantId)}`,
      );
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mensagens_export.xlsx`;
      a.click();
    } catch {
    } finally {
      setExporting(false);
    }
  }
  function handleDownloadTemplateMessages() {
    window.location.href = "/api/import_export/mensagem/template";
  }
  async function handleImportMessageFile(file: File) {
    if (!tenantId) return;
    setImportingMessage(true);
    setActionModal(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(
        `/api/import_export/mensagem/import?tenant_id=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          body: fd,
          headers: {
            ...(sess?.session?.access_token
              ? { Authorization: `Bearer ${sess.session.access_token}` }
              : {}),
          },
        },
      );
      addToast("success", "Importado");
    } catch {
    } finally {
      setImportingMessage(false);
    }
  }
  async function handleExportClients() {
    if (!tenantId) return;
    setExporting(true);
    try {
      const res = await fetch(
        `/api/import_export/cliente/export?tenant_id=${encodeURIComponent(tenantId)}`,
      );
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clientes_export.xlsx`;
      a.click();
    } catch {
    } finally {
      setExporting(false);
    }
  }
  function handleDownloadTemplate() {
    window.location.href = "/api/import_export/cliente/template";
  }
  async function handleImportFile(file: File) {
    if (!tenantId) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(
        `/api/import_export/cliente/import?tenant_id=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          body: fd,
          headers: {
            ...(sess?.session?.access_token
              ? { Authorization: `Bearer ${sess.session.access_token}` }
              : {}),
          },
        },
      );
      addToast("success", "Clientes Importados");
    } catch {
    } finally {
      setImporting(false);
    }
  }

  const handleResetPassword = async () => {
    const ok = await confirm({
      title: "Redefinir Senha",
      subtitle: `Enviar link de recuperação para ${email}?`,
      tone: "sky",
      confirmText: "Sim, enviar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    try {
      await supabaseBrowser.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/auth/update-password",
      });
      addToast("success", "Enviado", "Verifique sua caixa de entrada.");
    } catch (e: any) {
      addToast("error", "Erro", e.message);
    }
  };

  if (loading) {
    return (
      <div className="p-10 text-center text-muted-foreground/80 dark:text-muted-foreground animate-pulse bg-card border-border rounded-xl border m-6">
        Carregando painel...
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors text-foreground">
      <ToastNotifications toasts={toasts} removeToast={removeToast} />

      {/* HEADER DA PÁGINA */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              Perfil do Usuário
            </h1>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <div className="relative">
            <button
              onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
              className="h-9 w-9 shrink-0 rounded-xl border font-medium text-xs flex items-center justify-center bg-card border-border text-muted-foreground hover:bg-transparent dark:hover:bg-card/5 transition-all shadow-sm"
              title="Configurações"
            >
              <Settings className="w-4 h-4" />
            </button>

            {showSettingsDropdown && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowSettingsDropdown(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-56 bg-card dark:bg-[#1e2530] border border-border rounded-xl shadow-xl z-50 overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-200">
                  {/* Tema */}
                  <div className="px-3 py-2.5 border-b border-border">
                    <p className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wider mb-2">
                      Tema do Sistema
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setTheme("light");
                          setShowSettingsDropdown(false);
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${theme !== "dark" ? "bg-transparent text-foreground" : "text-muted-foreground hover:bg-card/5"}`}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <circle cx="12" cy="12" r="5" />
                          <line x1="12" y1="1" x2="12" y2="3" />
                          <line x1="12" y1="21" x2="12" y2="23" />
                          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                          <line x1="1" y1="12" x2="3" y2="12" />
                          <line x1="21" y1="12" x2="23" y2="12" />
                          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                        </svg>
                        Claro
                      </button>
                      <button
                        onClick={() => {
                          setTheme("dark");
                          setShowSettingsDropdown(false);
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${theme === "dark" ? "bg-card/10 text-foreground dark:text-white" : "text-muted-foreground hover:bg-transparent"}`}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                        </svg>
                        Escuro
                      </button>
                    </div>
                  </div>

                  {/* Editar Perfil */}
                  <button
                    onClick={() => {
                      setShowSettingsDropdown(false);
                      setIsEditing(true);
                    }}
                    className="w-full text-left px-3 py-2.5 text-xs font-medium text-muted-foreground dark:text-white/80 hover:bg-transparent dark:hover:bg-card/5 flex items-center gap-2.5 transition-colors border-b border-border"
                  >
                    <Pencil className="w-4 h-4" />
                    Editar Perfil
                  </button>

                  {/* 2ª Sessão WhatsApp */}
                  {whatsappSessions === 1 ? (
                    <button
                      onClick={() => {
                        setWhatsappSessions(2);
                        setIsEditing(true);
                        setShowSettingsDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2.5 text-xs font-medium text-muted-foreground dark:text-white/80 hover:bg-transparent dark:hover:bg-card/5 flex items-center gap-2.5 transition-colors border-b border-border"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="shrink-0 text-emerald-500"
                      >
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
                      </svg>
                      Habilitar 2ª Sessão WA
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setWhatsappSessions(1);
                        setIsEditing(true);
                        setShowSettingsDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2.5 text-xs font-medium text-rose-500 hover:bg-rose-500/10 dark:hover:bg-rose-500/10 flex items-center gap-2.5 transition-colors border-b border-border"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="shrink-0"
                      >
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
                      </svg>
                      Remover 2ª Sessão WA
                    </button>
                  )}

                  {/* Alterar Senha */}
                  <button
                    onClick={() => {
                      setShowSettingsDropdown(false);
                      handleResetPassword();
                    }}
                    className="w-full text-left px-3 py-2.5 text-xs font-medium text-muted-foreground dark:text-white/80 hover:bg-transparent dark:hover:bg-card/5 flex items-center gap-2.5 transition-colors"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="shrink-0 text-muted-foreground/80"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Alterar Senha
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* GRID PRINCIPAL */}
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-3">
        {/* COLUNA ESQUERDA: DADOS PESSOAIS + (ABA SAÚDE OU PLANILHAS) */}
        <div className="space-y-6 xl:col-span-2">
          {/* CARD 1: DADOS PESSOAIS (SEMPRE VISÍVEL) */}
          <div
            className={`bg-card border-y sm:border border-border sm:rounded-2xl p-4 sm:p-6 shadow-sm space-y-6 transition-all ${isEditing ? "ring-1 ring-emerald-500/20" : ""}`}
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-xs font-medium text-muted-foreground/80 dark:text-white/30 uppercase tracking-widest">
                Dados Cadastrais
              </h3>
              <div className="flex items-center gap-2">
                {isEditing && (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-all shadow-sm flex items-center gap-1.5"
                  >
                    {saving ? "..." : "💾 Salvar"}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Nome Completo</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                  readOnly={!isEditing}
                  onFocus={() => setIsEditing(true)}
                />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input
                  value={email}
                  disabled
                  className="opacity-70 cursor-not-allowed font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <div>
                <Label>País</Label>
                <div className="h-11 px-3 bg-transparent dark:bg-transparent border border-border rounded-xl flex items-center text-xs font-medium text-foreground/90 truncate">
                  {phonePrettyPrefix || "—"}
                </div>
              </div>
              <div>
                <Label>Telefone Celular</Label>
                <div className="relative">
                  <Input
                    value={phoneRaw}
                    onChange={(e) => setPhoneRaw(e.target.value)}
                    onBlur={handlePhoneDone}
                    onKeyDown={(e) => e.key === "Enter" && handlePhoneDone()}
                    placeholder="Ex: 21999999999"
                    readOnly={!isEditing}
                    onFocus={() => setIsEditing(true)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={handlePhoneDone}
                    disabled={!isEditing}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-transparent text-muted-foreground hover:text-emerald-500 transition-colors flex items-center justify-center font-medium"
                  >
                    ✓
                  </button>
                </div>
              </div>
              <div>
                <Label>WhatsApp Username</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/80 text-sm font-medium">
                    @
                  </span>
                  <Input
                    className="pl-8 pr-10"
                    value={whatsappUsername}
                    onChange={handleWhatsChange}
                    placeholder="Ex: 5521999999999"
                    readOnly={!isEditing}
                    onFocus={() => setIsEditing(true)}
                  />
                  {whatsappUsername && (
                    <a
                      href={`https://wa.me/${whatsappUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 hover:text-emerald-400"
                      title="Abrir conversa"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M12 0C5.373 0 0 4.98 0 11.111c0 3.508 1.777 6.64 4.622 8.67L3.333 24l4.444-2.222c1.333.37 2.592.556 4.223.556 6.627 0 12-4.98 12-11.111S18.627 0 12 0zm0 20c-1.37 0-2.703-.247-3.963-.733l-.283-.111-2.592 1.296.852-2.37-.37-.259C3.852 16.37 2.667 13.852 2.667 11.11 2.667 6.148 6.963 2.222 12 2.222c5.037 0 9.333 3.926 9.333 8.889S17.037 20 12 20zm5.037-6.63c-.278-.139-1.63-.815-1.889-.907-.259-.093-.445-.139-.63.139-.185.278-.722.907-.889 1.093-.167.185-.333.208-.611.069-.278-.139-1.167-.43-2.222-1.37-.822-.733-1.37-1.63-1.528-1.907-.157-.278-.017-.43.122-.569.126-.126.278-.333.417-.5.139-.167.185-.278.278-.463.093-.185.046-.347-.023-.486-.069-.139-.63-1.519-.863-2.083-.227-.546-.458-.472-.63-.48l-.54-.01c-.185 0-.486.069-.74.347-.254.278-.972.95-.972 2.315 0 1.365.996 2.685 1.135 2.87.139.185 1.96 2.997 4.87 4.207.681.294 1.213.47 1.628.602.684.217 1.306.187 1.797.113.548-.082 1.63-.667 1.86-1.31.23-.643.23-1.193.162-1.31-.069-.116-.254-.185-.532-.324z" />
                      </svg>
                    </a>
                  )}
                </div>
                {waValidation && (
                  <div
                    className={`mt-1.5 flex items-center gap-1.5 text-[10px] font-medium ${waValidation.loading ? "text-muted-foreground/80" : waValidation.exists ? "text-emerald-400" : "text-rose-500"}`}
                  >
                    {waValidation.loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Checando...
                      </>
                    ) : waValidation.exists ? (
                      <>✅ WhatsApp ativo</>
                    ) : (
                      <>❌ Não encontrado</>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <div>
                <Label>Nascimento</Label>
                <Input
                  type="date"
                  value={birthDate}
                  onChange={(e) => {
                    setBirthDate(e.target.value);
                    if (!isEditing) setIsEditing(true);
                  }}
                  readOnly={!isEditing}
                />
              </div>
              <div>
                <Label>Altura (m)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="1"
                  max="2.5"
                  value={profileHeight}
                  onChange={(e) => {
                    setProfileHeight(e.target.value);
                    if (!isEditing) setIsEditing(true);
                  }}
                  placeholder="1.75"
                  readOnly={!isEditing}
                />
              </div>
              <div>
                <Label>Sexo</Label>
                <select
                  value={gender}
                  onChange={(e) => {
                    setGender(e.target.value);
                    if (!isEditing) setIsEditing(true);
                  }}
                  disabled={!isEditing}
                  className="w-full h-11 px-2 sm:px-3 bg-transparent border border-border rounded-xl text-xs sm:text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Não informar</option>
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                </select>
              </div>
            </div>
          </div>

          {/* CARD 2 DINÂMICO: SAÚDE OU PLANILHAS */}
          <div className="bg-card border-y sm:border border-border sm:rounded-2xl p-4 sm:p-6 shadow-sm space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-xs font-medium text-muted-foreground/80 dark:text-white/30 uppercase tracking-widest">
                Saúde &amp; Avaliações
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (showHealthForm) {
                    setShowHealthForm(false);
                    setEditingHealthId(null);
                    setNewHealthEntry({
                      date: new Date().toISOString().split("T")[0],
                      weight: "",
                    });
                  } else {
                    setShowHealthForm(true);
                  }
                }}
                className="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-all shadow-sm"
              >
                {showHealthForm ? "← Cancelar" : "➕ Nova Avaliação"}
              </button>
            </div>

            {showHealthForm && (
              <div className="p-4 bg-transparent border border-border rounded-xl space-y-4">
                {!profileHeight && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                    ⚠️ Informe sua altura nos Dados Pessoais para calcular o
                    IMC.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Data da Medição</Label>
                    <Input
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      value={newHealthEntry.date}
                      onChange={(e) =>
                        setNewHealthEntry({
                          ...newHealthEntry,
                          date: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Peso (kg)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="Ex: 75.5"
                      value={newHealthEntry.weight}
                      onChange={(e) =>
                        setNewHealthEntry({
                          ...newHealthEntry,
                          weight: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowHealthForm(false);
                      setEditingHealthId(null);
                      setNewHealthEntry({
                        date: new Date().toISOString().split("T")[0],
                        weight: "",
                      });
                    }}
                    className="flex-1 h-10 border border-border text-muted-foreground font-medium rounded-xl text-xs hover:bg-transparent dark:hover:bg-card/5 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
  type="button"
  onClick={handleAddHealthEntry}
  disabled={saving}
  className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
>
  {saving ? "Salvando..." : editingHealthId ? "Atualizar" : "Registrar"}
</button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {sortedHistory.length === 0 ? (
                <div className="text-xs text-muted-foreground/80 text-center py-6 bg-transparent rounded-xl border border-dashed border-border">
                  Nenhuma avaliação registrada ainda.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Grid com 2 colunas */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {(() => {
                      const visibleRecords = showAllHealthRecords
                        ? sortedHistory
                        : sortedHistory.slice(0, 2);

                      const displayRecords = [...visibleRecords];

                      return displayRecords.map((record) => {
                        const isNewest = record.id === sortedHistory[0]?.id;
                        const hideOnMobile = !showAllHealthRecords && !isNewest;
                        return (
                          <div
                            key={record.id}
                            className={`items-center gap-3 p-3 rounded-xl border transition-colors group ${isNewest ? "border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_2px_8px_rgba(16,185,129,0.08)]" : "border-border bg-transparent/50 dark:bg-transparent"} ${hideOnMobile ? "hidden xl:flex" : "flex"}`}
                          >
                            {/* Data em bloco */}
                            <div className="shrink-0 text-center w-10">
                              <p className="text-[9px] font-medium text-muted-foreground/80 dark:text-white/30 uppercase leading-none">
                                {new Date(
                                  record.date + "T12:00:00",
                                ).toLocaleDateString("pt-BR", {
                                  month: "short",
                                })}
                              </p>
                              <p className="text-lg font-black text-foreground/90 leading-tight">
                                {new Date(record.date + "T12:00:00")
                                  .getDate()
                                  .toString()
                                  .padStart(2, "0")}
                              </p>
                              <p className="text-[9px] text-muted-foreground/80 dark:text-white/30 leading-none">
                                {new Date(
                                  record.date + "T12:00:00",
                                ).getFullYear()}
                              </p>
                            </div>
                            <div className="w-px h-9 bg-transparent shrink-0" />

                            {/* Métricas */}
                            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {record.weight} kg
                              </span>
                              {record.imc > 0 && (
                                <span
                                  className={`text-[11px] font-medium ${getImcColor(record.imc)}`}
                                >
                                  IMC {record.imc} · {getImcLabel(record.imc)}
                                </span>
                              )}
                              {isNewest && (
                                <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                  Mais recente
                                </span>
                              )}
                            </div>

                            {/* Ações */}
                            <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingHealthId(record.id);
                                  setNewHealthEntry({
                                    date: record.date,
                                    weight: String(record.weight),
                                  });
                                  setShowHealthForm(true);
                                }}
                                className="w-7 h-7 rounded-lg bg-card/5 border border-border flex items-center justify-center text-muted-foreground/80 hover:text-amber-500 transition-colors"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleDeleteHealthRecord(record.id)
                                }
                                className="w-7 h-7 rounded-lg bg-card/5 border border-border flex items-center justify-center text-muted-foreground/80 hover:text-rose-500 transition-colors"
                              >
                                <svg
                                  width="11"
                                  height="11"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Botão de Expandir/Contrair */}
                  {(sortedHistory.length > 2 || sortedHistory.length > 1) && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowAllHealthRecords(!showAllHealthRecords)
                      }
                      className="w-full py-2.5 mt-2 text-[11px] font-medium text-muted-foreground hover:text-foreground dark:hover:text-foreground dark:text-white transition-colors bg-transparent rounded-xl border border-border"
                    >
                      {showAllHealthRecords ? (
                        "↑ Ocultar avaliações anteriores"
                      ) : (
                        <>
                          <span className="xl:hidden">
                            ↓ Ver mais avaliações ({sortedHistory.length - 1})
                          </span>
                          <span className="hidden xl:inline">
                            ↓ Ver mais avaliações ({sortedHistory.length - 2})
                          </span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>

            {chartData.length > 1 &&
              (() => {
                const PAD_L = 56;
                const PAD_TOP = 42;
                const COL_W = 86;
                const ROW_H = 135;
                const DATE_H = 32; // Reduzido, pois a legenda foi removida do rodapé
                const W = PAD_L + COL_W * chartData.length;
                const H = ROW_H * 2 + DATE_H;

                const hFloat = parseFloat(profileHeight);
                const hasRef = hFloat > 0;
                const idealImcMin = 18.5,
                  idealImcMax = 24.9;
                const idealWMin = hasRef
                  ? parseFloat((idealImcMin * hFloat * hFloat).toFixed(1))
                  : null;
                const idealWMax = hasRef
                  ? parseFloat((idealImcMax * hFloat * hFloat).toFixed(1))
                  : null;

                const xs = chartData.map(
                  (_, i) => PAD_L + COL_W * i + COL_W / 2,
                );

                const scaleY = (
                  val: number,
                  vals: number[],
                  rowTop: number,
                ) => {
                  const min = Math.min(...vals);
                  const max = Math.max(...vals);
                  const range = max - min || 1;
                  const clamped = Math.max(min, Math.min(max, val));
                  return (
                    rowTop +
                    PAD_TOP +
                    (1 - (clamped - min) / range) * (ROW_H - PAD_TOP * 2)
                  );
                };

                const weights = chartData.map((d) => d.weight);
                const hasImc = chartData.every((d) => d.imc > 0);
                const imcs = chartData.map((d) => d.imc);
                const wYs = weights.map((v) => scaleY(v, weights, 0));
                const iYs = hasImc
                  ? imcs.map((v) => scaleY(v, imcs, ROW_H))
                  : [];

                const seg = (a: number, b: number) =>
                  Math.abs(a - b) < 0.05
                    ? "#94a3b8"
                    : b < a
                      ? "#10b981"
                      : "#f43f5e";
                const dot = (vals: number[], i: number) =>
                  i === 0 ? "#94a3b8" : seg(vals[i - 1], vals[i]);
                const fmtD = (d: string) => {
                  const [, m, day] = d.split("-");
                  return `${day}/${m}`;
                };

                const wBandT =
                  idealWMax != null ? scaleY(idealWMax, weights, 0) : null;
                const wBandB =
                  idealWMin != null ? scaleY(idealWMin, weights, 0) : null;
                const iBandT =
                  hasImc && hasRef ? scaleY(idealImcMax, imcs, ROW_H) : null;
                const iBandB =
                  hasImc && hasRef ? scaleY(idealImcMin, imcs, ROW_H) : null;

                return (
                  <div className="pt-4 border-t border-border">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
                      <div>
                        <Label>Histórico de Composição</Label>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/80 dark:text-white/50 mt-1">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-card border-2 border-[#10b981]" />
                            Caiu
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-card border-2 border-[#f43f5e]" />
                            Subiu
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-card border-2 border-[#94a3b8]" />
                            Estável
                          </span>
                          {hasRef && (
                            <span className="flex items-center gap-1.5">
                              <span className="w-3 h-2 rounded bg-[#10b981] opacity-20" />
                              Ideal
                            </span>
                          )}
                        </div>
                      </div>
                      {hasRef && idealWMin && (
                        <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full shrink-0">
                          <Target className="w-4 h-4 inline-block mr-1.5 text-emerald-500" />{" "}
                          Peso ideal: {idealWMin}–{idealWMax} kg · IMC 18,5–24,9
                        </span>
                      )}
                    </div>
                    <div className="w-full overflow-x-auto rounded-xl border border-border bg-card dark:bg-transparent">
                      <div className="relative" style={{ minWidth: `${W}px` }}>
                        {hoveredPt !== null &&
                          (() => {
                            const d = chartData[hoveredPt.i];
                            const first = chartData[0];
                            const prev =
                              hoveredPt.i > 0
                                ? chartData[hoveredPt.i - 1]
                                : null;
                            const diffFirst =
                              hoveredPt.i > 0
                                ? +(d.weight - first.weight).toFixed(1)
                                : null;
                            const diffPrev = prev
                              ? +(d.weight - prev.weight).toFixed(1)
                              : null;
                            const fmtFull = (s: string) => {
                              const [y, m, day] = s.split("-");
                              return `${day}/${m}/${y.slice(2)}`;
                            };
                            const arrow = (v: number) =>
                              v < 0 ? (
                                <TrendingDown className="w-4 h-4 inline-block text-emerald-500" />
                              ) : v > 0 ? (
                                <TrendingUp className="w-4 h-4 inline-block text-rose-500" />
                              ) : (
                                <ArrowRight className="w-4 h-4 inline-block text-muted-foreground/80" />
                              );
                            const pxX = (hoveredPt.x / W) * 100;
                            const flipLeft = pxX > 60;
                            return (
                              <div
                                className="absolute z-20 pointer-events-none"
                                style={{
                                  left: hoveredPt.x,
                                  top: hoveredPt.y - 10,
                                  transform: flipLeft
                                    ? "translate(-100%, -100%)"
                                    : "translate(8px, -100%)",
                                }}
                              >
                                <div className="bg-card dark:bg-[#1e2530] border border-border dark:border-white/15 rounded-xl shadow-xl px-3 py-2.5 space-y-1.5 min-w-[180px]">
                                  <p className="text-[11px] font-black text-foreground">
                                    {fmtFull(d.date)} — {d.weight} kg
                                    {d.imc > 0 ? ` · IMC ${d.imc}` : ""}
                                  </p>
                                  {diffFirst !== null && (
                                    <p className="text-[10px] text-foreground/70">
                                      {arrow(diffFirst)}{" "}
                                      <b
                                        className={
                                          diffFirst < 0
                                            ? "text-emerald-400"
                                            : diffFirst > 0
                                              ? "text-rose-500"
                                              : "text-muted-foreground/80"
                                        }
                                      >
                                        {diffFirst > 0 ? "+" : ""}
                                        {diffFirst} kg
                                      </b>{" "}
                                      desde {fmtFull(first.date)}
                                    </p>
                                  )}
                                  {diffPrev !== null && (
                                    <p className="text-[10px] text-foreground/70">
                                      {arrow(diffPrev)}{" "}
                                      <b
                                        className={
                                          diffPrev < 0
                                            ? "text-emerald-400"
                                            : diffPrev > 0
                                              ? "text-rose-500"
                                              : "text-muted-foreground/80"
                                        }
                                      >
                                        {diffPrev > 0 ? "+" : ""}
                                        {diffPrev} kg
                                      </b>{" "}
                                      vs anterior ({fmtFull(prev!.date)})
                                    </p>
                                  )}
                                  {hoveredPt.i === 0 && (
                                    <p className="text-[10px] text-muted-foreground/80 dark:text-muted-foreground italic">
                                      Primeiro registro
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        <svg
                          viewBox={`0 0 ${W} ${H}`}
                          style={{
                            minWidth: `${W}px`,
                            height: `${H}px`,
                            display: "block",
                          }}
                        >
                          {/* Row backgrounds */}
                          <rect
                            x={0}
                            y={0}
                            width={W}
                            height={ROW_H}
                            fill="currentColor"
                            fillOpacity="0.025"
                          />
                          <rect
                            x={0}
                            y={ROW_H}
                            width={W}
                            height={ROW_H}
                            fill="currentColor"
                            fillOpacity="0.012"
                          />

                          {/* Reference bands (ideal range) */}
                          {wBandT != null && wBandB != null && (
                            <rect
                              x={PAD_L}
                              y={wBandT}
                              width={W - PAD_L}
                              height={Math.max(3, wBandB - wBandT)}
                              fill="#10b981"
                              fillOpacity="0.09"
                            />
                          )}
                          {iBandT != null && iBandB != null && (
                            <rect
                              x={PAD_L}
                              y={iBandT}
                              width={W - PAD_L}
                              height={Math.max(3, iBandB - iBandT)}
                              fill="#10b981"
                              fillOpacity="0.09"
                            />
                          )}

                          {/* Dividers */}
                          <line
                            x1={0}
                            y1={ROW_H}
                            x2={W}
                            y2={ROW_H}
                            stroke="currentColor"
                            strokeOpacity="0.08"
                            strokeWidth="1"
                          />
                          <line
                            x1={0}
                            y1={ROW_H * 2}
                            x2={W}
                            y2={ROW_H * 2}
                            stroke="currentColor"
                            strokeOpacity="0.08"
                            strokeWidth="1"
                          />

                          {/* Vertical dashes */}
                          {chartData.map(
                            (_, i) =>
                              i > 0 && (
                                <line
                                  key={i}
                                  x1={PAD_L + COL_W * i}
                                  y1={0}
                                  x2={PAD_L + COL_W * i}
                                  y2={ROW_H * 2 + DATE_H}
                                  stroke="currentColor"
                                  strokeOpacity="0.06"
                                  strokeWidth="1"
                                  strokeDasharray="3,4"
                                />
                              ),
                          )}

                          {/* Row labels */}
                          <text
                            x={PAD_L - 6}
                            y={ROW_H / 2 - 7}
                            textAnchor="end"
                            fontSize="9.5"
                            fontWeight="bold"
                            fill="currentColor"
                            fillOpacity="0.6"
                          >
                            Peso
                          </text>
                          <text
                            x={PAD_L - 6}
                            y={ROW_H / 2 + 6}
                            textAnchor="end"
                            fontSize="8"
                            fill="currentColor"
                            fillOpacity="0.35"
                          >
                            (kg)
                          </text>
                          {hasImc && (
                            <>
                              <text
                                x={PAD_L - 6}
                                y={ROW_H + ROW_H / 2 - 4}
                                textAnchor="end"
                                fontSize="9.5"
                                fontWeight="bold"
                                fill="currentColor"
                                fillOpacity="0.6"
                              >
                                IMC
                              </text>
                            </>
                          )}

                          {/* Weight line segments */}
                          {chartData.slice(1).map((_, i) => (
                            <line
                              key={i}
                              x1={xs[i]}
                              y1={wYs[i]}
                              x2={xs[i + 1]}
                              y2={wYs[i + 1]}
                              stroke={seg(weights[i], weights[i + 1])}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              opacity="0.9"
                            />
                          ))}

                          {/* IMC line segments */}
                          {hasImc &&
                            chartData
                              .slice(1)
                              .map((_, i) => (
                                <line
                                  key={i}
                                  x1={xs[i]}
                                  y1={iYs[i]}
                                  x2={xs[i + 1]}
                                  y2={iYs[i + 1]}
                                  stroke={seg(imcs[i], imcs[i + 1])}
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  opacity="0.85"
                                />
                              ))}

                          {/* Weight: value above + dot */}
                          {chartData.map((d, i) => (
                            <g
                              key={i}
                              style={{ cursor: "pointer" }}
                              onMouseEnter={(e) =>
                                setHoveredPt({ i, x: xs[i], y: wYs[i] })
                              }
                              onMouseLeave={() => setHoveredPt(null)}
                            >
                              <text
                                x={xs[i]}
                                y={wYs[i] - 14}
                                textAnchor="middle"
                                fontSize="10.5"
                                fontWeight="bold"
                                fill="currentColor"
                                fillOpacity="0.85"
                              >
                                {d.weight}
                              </text>
                              <circle
                                cx={xs[i]}
                                cy={wYs[i]}
                                r="5.5"
                                fill="white"
                                stroke={dot(weights, i)}
                                strokeWidth="2.5"
                              />
                              {/* Hit area invisível maior */}
                              <circle
                                cx={xs[i]}
                                cy={wYs[i]}
                                r="14"
                                fill="transparent"
                              />
                            </g>
                          ))}

                          {/* IMC: value below + dot (Evita encostar no gráfico de peso) */}
                          {hasImc &&
                            chartData.map((d, i) => (
                              <g key={i}>
                                <text
                                  x={xs[i]}
                                  y={iYs[i] + 18}
                                  textAnchor="middle"
                                  fontSize="10.5"
                                  fontWeight="600"
                                  fill="currentColor"
                                  fillOpacity="0.75"
                                >
                                  {d.imc}
                                </text>
                                <circle
                                  cx={xs[i]}
                                  cy={iYs[i]}
                                  r="4.5"
                                  fill="white"
                                  stroke={dot(imcs, i)}
                                  strokeWidth="2"
                                />
                              </g>
                            ))}

                          {/* Dates */}
                          {chartData.map((d, i) => (
                            <text
                              key={i}
                              x={xs[i]}
                              y={ROW_H * 2 + 18}
                              textAnchor="middle"
                              fontSize="9.5"
                              fill="currentColor"
                              fillOpacity="0.45"
                            >
                              {fmtD(d.date)}
                            </text>
                          ))}
                        </svg>
                      </div>
                    </div>
                  </div>
                );
              })()}
          </div>
        </div>

        {/* COLUNA DIREITA: PAINÉIS DO WHATSAPP (SEMPRE VISÍVEL) */}
        <div className="space-y-6">
          {/* PAINEL SESSÃO 1 */}
          <div className="bg-card border-y sm:border border-border sm:rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="text-xs font-medium text-muted-foreground/80 dark:text-white/30 uppercase tracking-widest">
                WhatsApp — Instância 1
              </h3>
            </div>

            {!canPairWhatsApp ? (
              <div className="p-3 rounded-lg bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:bg-amber-500/10 dark:border-amber-500/20 text-xs text-center font-medium">
                Aguardando login estrutural.
              </div>
            ) : (
              <div className="space-y-4">
                {waIsDormant && !waConnected ? (
                  <button
                    type="button"
                    onClick={() => {
                      setWaIsDormant(false);
                      void refreshWhatsAppPanel(true);
                    }}
                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-sm transition-all mt-2"
                  >
                    {waLoading ? "Gerando..." : "📲 Inicializar QR Code"}
                  </button>
                ) : (
                  <>
                    <div className="relative p-4 rounded-xl border border-border bg-transparent flex gap-5 items-center">
                      <div className="absolute top-3 right-3 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void refreshWhatsAppPanel()}
                          disabled={waLoading}
                          className="w-8 h-8 rounded-lg bg-card/5 border border-border flex items-center justify-center text-muted-foreground hover:text-emerald-400 transition-colors shadow-sm disabled:opacity-50"
                          title="Sincronizar"
                        >
                          {waLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                            >
                              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-4.54 4.54" />
                            </svg>
                          )}
                        </button>
                        {waConnected && (
                          <button
                            type="button"
                            onClick={() => setShowWa1Settings(true)}
                            className="w-8 h-8 rounded-lg bg-card/5 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground dark:hover:text-foreground dark:text-white transition-colors shadow-sm"
                            title="Configurações de Chamada"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                            >
                              <circle cx="12" cy="12" r="3"></circle>
                              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                          </button>
                        )}
                      </div>

                      {/* ✅ Círculo — só foto de perfil, QR foi movido para baixo */}
                      <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-full bg-card border-4 border-border overflow-hidden flex items-center justify-center shadow-sm">
                        {waProfilePicUrl ? (
                          <img
                            src={waProfilePicUrl}
                            alt="Avatar"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-xl font-medium text-slate-300 dark:text-white/20">
                            WA
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col gap-1.5 justify-center">
                        <div className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">
                            Nome:
                          </span>{" "}
                          {waPushName || "Aguardando"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">
                            Chamadas:
                          </span>{" "}
                          {waRejectCalls ? (
                            <span>
                              Rejeitadas{" "}
                              <Ban className="w-3 h-3 inline-block text-rose-500 ml-1" />
                            </span>
                          ) : (
                            <span>
                              Permitidas{" "}
                              <CheckCircle2 className="w-3 h-3 inline-block text-emerald-500 ml-1" />
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                          <span className="font-medium text-foreground">
                            Status:
                          </span>
                          <span
                            className={`gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm border ${waConnected ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400" : "bg-rose-500/10 text-rose-400 border-rose-500/20 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400"}`}
                          >
                            {waConnected ? "On-line" : "Off-line"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ✅ QR Code grande — aparece abaixo do card quando offline */}
                    {waQrDataUrl && !waConnected && (
                      <div className="flex flex-col items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                        <img
                          src={waQrDataUrl}
                          alt="QR Code WhatsApp"
                          className="w-52 h-52 rounded-xl object-contain"
                        />
                        <p className="text-[11px] text-emerald-400 font-medium text-center">
                          📱 Escaneie com o WhatsApp
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleReconnectWhatsApp()}
                        disabled={waReconnecting}
                        className="flex-1 py-2 rounded-xl bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400 font-medium text-xs hover:bg-amber-500/20 transition-colors shadow-sm"
                      >
                        <RefreshCcw className="w-4 h-4 mr-1.5 inline-block" />{" "}
                        Reiniciar
                      </button>
                      {waConnected && (
                        <button
                          type="button"
                          onClick={() => void handleDisconnectWhatsApp()}
                          className="flex-1 py-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 font-medium text-xs hover:bg-rose-500/20 transition-colors shadow-sm"
                        >
                          <Plug className="w-4 h-4 mr-1.5 inline-block" />{" "}
                          Desconectar
                        </button>
                      )}
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
              onDisable={() => {
                setWhatsappSessions(1);
                if (!isEditing) setIsEditing(true);
              }}
            />
          )}

          {/* CARD IMPORT / EXPORT */}
          <div className="bg-card border-y sm:border border-border sm:rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-xs font-medium text-muted-foreground/80 dark:text-white/30 uppercase tracking-widest">
                Dados &amp; Planilhas
              </h3>
              <button
                type="button"
                onClick={() => setActionModal("template")}
                disabled={!tenantId}
                className="flex items-center gap-1.5 h-8 px-2 sm:px-3 rounded-xl border border-border bg-transparent text-muted-foreground hover:bg-transparent dark:hover:bg-card/10 transition-all"
                title="Baixar Templates"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span className="text-xs font-medium">Templates</span>
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActionModal("export")}
                disabled={!tenantId || exporting}
                className="flex-1 h-11 px-3 rounded-xl border border-border bg-transparent font-medium text-xs text-foreground/90 hover:bg-transparent dark:hover:bg-card/10 transition-all flex items-center justify-center gap-2"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span className="hidden sm:inline">Exportar Registros</span>
                <span className="sm:hidden">Exportar</span>
              </button>
              <button
                type="button"
                onClick={() => setActionModal("import")}
                disabled={
                  !tenantId ||
                  importing ||
                  importingApps ||
                  importingAuto ||
                  importingReseller ||
                  importingMessage ||
                  importingServer
                }
                className="flex-1 h-11 px-3 rounded-xl border border-border bg-transparent font-medium text-xs text-foreground/90 hover:bg-transparent dark:hover:bg-card/10 transition-all flex items-center justify-center gap-2"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className="hidden sm:inline">Importar Registros</span>
                <span className="sm:hidden">Importar</span>
              </button>
            </div>

            {/* INPUTS OCULTOS — mantidos aqui para os handlers funcionarem */}
            <input
              ref={importFileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportFile(f);
              }}
            />
            <input
              ref={importAppsFileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportAppsFile(f);
              }}
            />
            <input
              ref={importAutoFileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportAutoFile(f);
              }}
            />
            <input
              ref={importResellerFileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportResellerFile(f);
              }}
            />
            <input
              ref={importMessageFileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportMessageFile(f);
              }}
            />
            <input
              ref={importServerFileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportServerFile(f);
              }}
            />
            <input
              ref={importFinanceiroFileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportFinanceiroFile(f);
              }}
            />
          </div>
        </div>
      </div>

      {/* ============================================================================
          MODALS DE IMPORT/EXPORT
         ============================================================================ */}
      {actionModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-sm rounded-xl border border-border shadow-xl p-6 space-y-4 text-left">
            <h3 className="text-sm font-medium text-foreground">
              {actionModal === "export" && "⬇️ Exportar Dados"}
              {actionModal === "template" && "📄 Baixar Templates"}
              {actionModal === "import" && "⬆️ Importar Dados"}
            </h3>
            <div className="flex flex-col gap-2">
              {[
                {
                  n: "Servidores",
                  icon: "🖥️",
                  act: () => {
                    if (actionModal === "export") void handleExportServers();
                    else if (actionModal === "template")
                      handleDownloadTemplateServers();
                    else importServerFileRef.current?.click();
                  },
                },
                {
                  n: "Mensagens WhatsApp",
                  icon: "💬",
                  act: () => {
                    if (actionModal === "export") void handleExportMessages();
                    else if (actionModal === "template")
                      handleDownloadTemplateMessages();
                    else importMessageFileRef.current?.click();
                  },
                },
                {
                  n: "Automações de Cobrança",
                  icon: "💵",
                  act: () => {
                    if (actionModal === "export") void handleExportAuto();
                    else if (actionModal === "template")
                      handleDownloadTemplateAuto();
                    else importAutoFileRef.current?.click();
                  },
                },
                {
                  n: "Clientes",
                  icon: "👥",
                  act: () => {
                    if (actionModal === "export") void handleExportClients();
                    else if (actionModal === "template")
                      handleDownloadTemplate();
                    else importFileRef.current?.click();
                  },
                },
                {
                  n: "Aplicativos vinculados",
                  icon: "📱",
                  act: () => {
                    if (actionModal === "export") void handleExportApps();
                    else if (actionModal === "template")
                      handleDownloadTemplateApps();
                    else importAppsFileRef.current?.click();
                  },
                },
                {
                  n: "Revendedores",
                  icon: "🤝",
                  act: () => {
                    if (actionModal === "export") void handleExportResellers();
                    else if (actionModal === "template")
                      handleDownloadTemplateResellers();
                    else importResellerFileRef.current?.click();
                  },
                },
                {
                  n: "Controle Financeiro",
                  icon: "💰",
                  act: () => {
                    if (actionModal === "export")
                      setShowFinanceiroExportModal(true);
                    else if (actionModal === "template")
                      handleDownloadTemplateFinanceiro();
                    else importFinanceiroFileRef.current?.click();
                  },
                },
              ].map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setActionModal(null);
                    item.act();
                  }}
                  className="w-full text-left text-xs p-3 font-semibold rounded-lg border border-border bg-transparent hover:bg-transparent dark:hover:bg-card/10 text-foreground/90 transition-colors flex items-center gap-2"
                >
                  <span>{item.icon}</span> {item.n}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setActionModal(null)}
              className="w-full text-center text-xs font-medium text-muted-foreground/80 mt-2 hover:text-muted-foreground dark:hover:text-white/80"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ============================================================================
          MODAL DE CONFIGURAÇÕES DE CHAMADA (SESSÃO 1) - TOTALMENTE REFEITO
         ============================================================================ */}
      {showWa1Settings && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border p-6 shadow-2xl animate-in zoom-in-95 max-h-[92vh] overflow-y-auto">
            <div className="space-y-5">
              {/* Cabeçalho */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-medium text-foreground">
                    ⚙️ Instância 1 — Configurações
                  </h3>
                  <p className="text-xs text-muted-foreground/80 dark:text-muted-foreground mt-0.5">
                    Controle de chamadas recebidas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWa1Settings(false)}
                  className="shrink-0 w-8 h-8 rounded-xl bg-transparent flex items-center justify-center text-muted-foreground hover:text-foreground dark:hover:text-foreground dark:text-white text-lg leading-none transition-colors"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-transparent">
                <span className="text-sm font-medium text-foreground/90">
                  📵 Rejeitar Chamadas
                </span>
                <button
                  type="button"
                  onClick={() => setWaRejectCalls((v) => !v)}
                  className={`relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 overflow-hidden ${waRejectCalls ? "bg-emerald-500" : "bg-transparent dark:bg-card/20"}`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card shadow-sm transition-transform duration-200 ${waRejectCalls ? "translate-x-5" : "translate-x-0"}`}
                  />
                </button>
              </div>

              {waRejectCalls && (
                <div className="space-y-4">
                  {/* MENSAGEM */}
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground/80 dark:text-muted-foreground uppercase mb-1.5">
                      Mensagem de Resposta
                    </label>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {["{saudacao}", "{hora}", "{data}"].map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setWaRejectMessage((v) => v + tag)}
 className="text-[10px] px-2 py-0.5 rounded border border-border bg-card/5 hover:bg-emerald-500/10 dark:hover:bg-emerald-900/20 text-muted-foreground dark:text-white transition-colors"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={waRejectMessage}
                      onChange={(e) => setWaRejectMessage(e.target.value)}
                      rows={2}
                      placeholder="Ex: {saudacao}! Não atendo ligações..."
                      className="w-full px-3 py-2 text-xs bg-card border border-border rounded-xl text-foreground outline-none focus:border-emerald-500/50 resize-none"
                    />
                  </div>

                  {/* LISTA BRANCA */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-medium text-muted-foreground/80 dark:text-muted-foreground uppercase">
                        Lista Branca (Exceções)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setWaAllowedList([
                            {
                              id: Math.random().toString(36).slice(2),
                              name: "",
                              raw: "",
                              e164: "",
                              loading: false,
                              exists: null,
                            },
                            ...waAllowedList,
                          ])
                        }
                        className="text-[10px] font-medium text-emerald-400 hover:underline"
                      >
                        + Adicionar
                      </button>
                    </div>

                    <div className="max-h-40 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      {waAllowedList.length === 0 ? (
                        <div className="text-xs text-center text-muted-foreground/80 py-4 bg-transparent rounded-xl border border-dashed border-border">
                          Nenhum número liberado.
                        </div>
                      ) : (
                        waAllowedList.map((row) => (
                          <div
                            key={row.id}
                            className="flex flex-col gap-1.5 p-2 rounded-xl border border-border bg-transparent"
                          >
                            <div className="flex gap-2 items-center">
                              <input
                                value={row.name}
                                onChange={(e) =>
                                  setWaAllowedList((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id
                                        ? { ...r, name: e.target.value }
                                        : r,
                                    ),
                                  )
                                }
                                placeholder="Nome"
                                className="w-1/3 h-8 px-2 text-xs bg-card border border-border rounded-lg outline-none focus:border-emerald-500/50 text-foreground placeholder-slate-400"
                              />
                              <input
                                value={row.raw}
                                onChange={(e) =>
                                  setWaAllowedList((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id
                                        ? {
                                            ...r,
                                            raw: e.target.value,
                                            exists: null,
                                          }
                                        : r,
                                    ),
                                  )
                                }
                                onBlur={() => validateWaRow(row.id, row.raw)}
                                placeholder="Número com DDI"
                                className="flex-1 h-8 px-2 text-xs font-mono bg-card border border-border rounded-lg outline-none focus:border-emerald-500/50 text-foreground placeholder-slate-400"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setWaAllowedList((prev) =>
                                    prev.filter((r) => r.id !== row.id),
                                  )
                                }
                                className="w-8 h-8 flex items-center justify-center text-rose-500 bg-card border border-border rounded-lg hover:bg-rose-500/10 dark:hover:bg-rose-500/10 transition-colors"
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            </div>
                            <div className="text-[9px] font-medium px-1">
                              {row.loading ? (
                                <span className="text-muted-foreground/80">
                                  Validando...
                                </span>
                              ) : row.exists === true ? (
                                <span className="text-emerald-500">
                                  ✅ WhatsApp OK
                                </span>
                              ) : row.exists === false ? (
                                <span className="text-rose-500">
                                  ❌ Não tem WhatsApp
                                </span>
                              ) : (
                                <span className="text-muted-foreground/80">
                                  Termine para validar
                                </span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2 border-t border-border mt-4">
                <button
                  type="button"
                  onClick={() => setShowWa1Settings(false)}
                  className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground/80 font-medium text-xs hover:bg-transparent dark:hover:bg-card/5 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void saveWaConfig()}
                  disabled={waSavingConfig}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-transform active:scale-95 disabled:opacity-60"
                >
                  {waSavingConfig ? "Salvando..." : "Salvar Configuração"}
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
// SESSÃO WHATSAPP 2 (COM O MESMO MODAL REFEITO)
// ============================================================================
function WhatsAppSession2Panel({
  canPair,
  tenantId,
  addToast,
  onDisable,
}: {
  canPair: boolean;
  tenantId: string | null;
  addToast: any;
  onDisable: () => void;
}) {
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
  const [waRejectMessage, setWaRejectMessage] = useState(
    "{saudacao}! 😊\nNo momento não estou recebendo ligações. Por favor, envie mensagem.",
  );
  const [waAllowedList, setWaAllowedList] = useState<AllowedNumberRow[]>([]);
  const [waSavingConfig, setWaSavingConfig] = useState(false);

  async function fetchWaConfig() {
    try {
      const res = await fetch("/api/whatsapp/config2", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setWaRejectCalls(json.rejectCalls ?? true);
        setWaRejectMessage(json.rejectMessage ?? "");
        setWaAllowedList(parseAllowedNumbers(json.allowedNumbers ?? []));
      }
    } catch {}
  }

  async function saveWaConfig() {
    setWaSavingConfig(true);
    try {
      const allowedNumbers = stringifyAllowedNumbers(waAllowedList);
      const res = await fetch("/api/whatsapp/config2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rejectCalls: waRejectCalls,
          rejectMessage: waRejectMessage,
          allowedNumbers,
        }),
      });
      if (res.ok) {
        addToast("success", "Salvo", "Regras da Sessão 2 atualizadas.");
        setShowWa2Settings(false);
      }
    } catch (e: any) {
      addToast("error", "Erro", e.message);
    } finally {
      setWaSavingConfig(false);
    }
  }

  async function validateWaRow(id: string, currentRaw: string) {
    const digits = onlyDigits(currentRaw);
    if (digits.length < 8) {
      setWaAllowedList((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, loading: false, exists: false } : r,
        ),
      );
      return;
    }
    setWaAllowedList((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, loading: true, exists: null } : r,
      ),
    );
    try {
      const res = await fetch("/api/whatsapp/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const json = await res.json().catch(() => ({}));
      let updatedRaw = currentRaw;
      let updatedE164 = "";
      if (json.exists && json.jid) {
        const jidDigits = String(json.jid)
          .split("@")[0]
          .split(":")[0]
          .replace(/\D/g, "");
        const norm = applyPhoneNormalization(jidDigits);
        updatedRaw = norm.formattedNational || currentRaw;
        updatedE164 = norm.e164;
      }
      setWaAllowedList((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                loading: false,
                exists: !!json.exists,
                raw: updatedRaw,
                e164: updatedE164,
              }
            : r,
        ),
      );
    } catch {
      setWaAllowedList((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, loading: false, exists: false } : r,
        ),
      );
    }
  }

  async function fetchWaStatus() {
    try {
      const res = await fetch("/api/whatsapp/status2", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setWaConnected(!!json.connected);
      return { connected: !!json.connected, status: json.status };
    } catch {
      return { connected: false, status: "error" };
    }
  }

  async function refreshPanel(forceQr = false, showVisualLoading = true) {
    if (showVisualLoading) setWaLoading(true);
    try {
      const { connected, status } = await fetchWaStatus();
      if (connected) {
        setIsDormant(false);
        setWaQrDataUrl(null);
        await fetchWaConfig();
        if (showVisualLoading)
          addToast("success", "Sincronizado", "Painel da Sessão 2 atualizado.");
        return;
      }
      if (forceQr || status === "qr" || status === "connecting") {
        const res = await fetch("/api/whatsapp/qr2", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setWaQrDataUrl(json?.qr || null);
      } else {
        setWaQrDataUrl(null);
      }
    } finally {
      if (showVisualLoading) setWaLoading(false);
    }
  }

  async function handleDisconnect() {
    const ok = await confirm({
      title: "Desconectar?",
      subtitle: "Encerrar sessão 2.",
      tone: "rose",
      confirmText: "Desconectar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setWaLoading(true);
    try {
      await fetch("/api/whatsapp/disconnect2", { method: "POST" });
      setWaConnected(false);
      setWaQrDataUrl(null);
      setIsDormant(true);
      addToast("success", "Desconectado");
    } catch {
    } finally {
      setWaLoading(false);
    }
  }

  async function handleReconnect() {
    const ok = await confirm({
      title: "Reiniciar Instância 2?",
      subtitle: "Forçar reinicialização.",
      tone: "amber",
      confirmText: "Reconectar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setIsReconnecting(true);
    try {
      await fetch("/api/whatsapp/reconnect2", { method: "POST" });
      setWaConnected(false);
      setWaQrDataUrl(null);
      setIsDormant(false);
      setTimeout(() => void refreshPanel(true, false), 4000);
    } catch {
    } finally {
      setIsReconnecting(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4 animate-in fade-in">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-xs font-medium text-muted-foreground/80 dark:text-white/30 uppercase tracking-widest">
          WhatsApp — Instância 2
        </h3>
        <button
          type="button"
          onClick={onDisable}
          className="text-[10px] font-medium text-rose-500 hover:underline"
        >
          - Desabilitar Sessão
        </button>
      </div>

      <div className="space-y-4">
        {isDormant && !waConnected ? (
          <button
            type="button"
            onClick={() => {
              setIsDormant(false);
              void refreshPanel(true);
            }}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-sm transition-all mt-2"
          >
            {waLoading ? "Gerando..." : "📲 Inicializar QR Code 2"}
          </button>
        ) : (
          <>
            <div className="relative p-4 rounded-xl border border-border bg-transparent flex gap-5 items-center">
              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void refreshPanel()}
                  disabled={waLoading}
                  className="w-8 h-8 rounded-lg bg-card/5 border border-border flex items-center justify-center text-muted-foreground hover:text-emerald-400 transition-colors shadow-sm disabled:opacity-50"
                  title="Sincronizar"
                >
                  {waLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-4.54 4.54" />
                    </svg>
                  )}
                </button>
                {waConnected && (
                  <button
                    type="button"
                    onClick={() => setShowWa2Settings(true)}
                    className="w-8 h-8 rounded-lg bg-card/5 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground dark:hover:text-foreground dark:text-white transition-colors shadow-sm"
                    title="Configurações"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                  </button>
                )}
              </div>

              <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-full bg-card border-4 border-border overflow-hidden flex items-center justify-center shadow-sm">
                {waProfilePicUrl ? (
                  <img
                    src={waProfilePicUrl}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                  />
                ) : waQrDataUrl ? (
                  <img
                    src={waQrDataUrl}
                    alt="QR Code"
                    className="w-full h-full object-cover p-1"
                  />
                ) : (
                  <span className="text-xl font-medium text-slate-300 dark:text-white/20">
                    WA
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-1.5 justify-center">
                <div className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Nome:
                  </span>{" "}
                  {waPushName || "Aguardando"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Chamadas:
                  </span>{" "}
                  {waRejectCalls ? (
                    <span>
                      Rejeitadas{" "}
                      <Ban className="w-3 h-3 inline-block text-rose-500 ml-1" />
                    </span>
                  ) : (
                    <span>
                      Permitidas{" "}
                      <CheckCircle2 className="w-3 h-3 inline-block text-emerald-500 ml-1" />
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                  <span className="font-medium text-foreground">
                    Status:
                  </span>
                  <span
                    className={`gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm border ${waConnected ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400" : "bg-rose-500/10 text-rose-400 border-rose-500/20 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400"}`}
                  >
                    {waConnected ? "On-line" : "Off-line"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => void handleReconnect()}
                disabled={isReconnecting}
                className="flex-1 py-2 rounded-xl bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400 font-medium text-xs hover:bg-amber-500/20 transition-colors shadow-sm"
              >
                <RefreshCcw className="w-4 h-4 mr-1.5 inline-block" /> Reiniciar
              </button>
              {waConnected && (
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  className="flex-1 py-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 font-medium text-xs hover:bg-rose-500/20 transition-colors shadow-sm"
                >
                  <Plug className="w-4 h-4 mr-1.5 inline-block" /> Desligar
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal Settings Wa 2 */}
      {showWa2Settings && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border p-6 shadow-2xl animate-in zoom-in-95 max-h-[92vh] overflow-y-auto">
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-medium text-foreground">
                    ⚙️ Instância 2 — Configurações
                  </h3>
                  <p className="text-xs text-muted-foreground/80 dark:text-muted-foreground mt-0.5">
                    Controle de chamadas recebidas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWa2Settings(false)}
                  className="shrink-0 w-8 h-8 rounded-xl bg-transparent flex items-center justify-center text-muted-foreground hover:text-foreground dark:hover:text-foreground dark:text-white text-lg leading-none transition-colors"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-transparent">
                <span className="text-sm font-medium text-foreground/90">
                  📵 Rejeitar Chamadas
                </span>
                <button
                  type="button"
                  onClick={() => setWaRejectCalls((v) => !v)}
                  className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${waRejectCalls ? "bg-emerald-500" : "bg-transparent dark:bg-card/20"}`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-card shadow transition-transform ${waRejectCalls ? "translate-x-5" : "translate-x-0"}`}
                  />
                </button>
              </div>

              {waRejectCalls && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground/80 dark:text-muted-foreground uppercase mb-1.5">
                      Mensagem de Resposta
                    </label>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {["{saudacao}", "{hora}", "{data}"].map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setWaRejectMessage((v) => v + tag)}
 className="text-[10px] px-2 py-0.5 rounded border border-border bg-card/5 hover:bg-emerald-500/10 dark:hover:bg-emerald-900/20 text-muted-foreground dark:text-white transition-colors"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={waRejectMessage}
                      onChange={(e) => setWaRejectMessage(e.target.value)}
                      rows={2}
                      placeholder="Ex: {saudacao}! Não atendo ligações..."
                      className="w-full px-3 py-2 text-xs bg-card border border-border rounded-xl text-foreground outline-none focus:border-emerald-500/50 resize-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-medium text-muted-foreground/80 dark:text-muted-foreground uppercase">
                        Lista Branca (Exceções)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setWaAllowedList([
                            {
                              id: Math.random().toString(36).slice(2),
                              name: "",
                              raw: "",
                              e164: "",
                              loading: false,
                              exists: null,
                            },
                            ...waAllowedList,
                          ])
                        }
                        className="text-[10px] font-medium text-emerald-400 hover:underline"
                      >
                        + Adicionar
                      </button>
                    </div>

                    <div className="max-h-40 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      {waAllowedList.length === 0 ? (
                        <div className="text-xs text-center text-muted-foreground/80 py-4 bg-transparent rounded-xl border border-dashed border-border">
                          Nenhum número liberado.
                        </div>
                      ) : (
                        waAllowedList.map((row) => (
                          <div
                            key={row.id}
                            className="flex flex-col gap-1.5 p-2 rounded-xl border border-border bg-transparent"
                          >
                            <div className="flex gap-2 items-center">
                              <input
                                value={row.name}
                                onChange={(e) =>
                                  setWaAllowedList((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id
                                        ? { ...r, name: e.target.value }
                                        : r,
                                    ),
                                  )
                                }
                                placeholder="Nome"
                                className="w-1/3 h-8 px-2 text-xs bg-card border border-border rounded-lg outline-none focus:border-emerald-500/50 text-foreground placeholder-slate-400"
                              />
                              <input
                                value={row.raw}
                                onChange={(e) =>
                                  setWaAllowedList((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id
                                        ? {
                                            ...r,
                                            raw: e.target.value,
                                            exists: null,
                                          }
                                        : r,
                                    ),
                                  )
                                }
                                onBlur={() => validateWaRow(row.id, row.raw)}
                                placeholder="Número com DDI"
                                className="flex-1 h-8 px-2 text-xs font-mono bg-card border border-border rounded-lg outline-none focus:border-emerald-500/50 text-foreground placeholder-slate-400"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setWaAllowedList((prev) =>
                                    prev.filter((r) => r.id !== row.id),
                                  )
                                }
                                className="w-8 h-8 flex items-center justify-center text-rose-500 bg-card border border-border rounded-lg hover:bg-rose-500/10 dark:hover:bg-rose-500/10 transition-colors"
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            </div>
                            <div className="text-[9px] font-medium px-1">
                              {row.loading ? (
                                <span className="text-muted-foreground/80">
                                  Validando...
                                </span>
                              ) : row.exists === true ? (
                                <span className="text-emerald-500">
                                  ✅ WhatsApp OK
                                </span>
                              ) : row.exists === false ? (
                                <span className="text-rose-500">
                                  ❌ Não tem WhatsApp
                                </span>
                              ) : (
                                <span className="text-muted-foreground/80">
                                  Termine para validar
                                </span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2 border-t border-border mt-4">
                <button
                  type="button"
                  onClick={() => setShowWa2Settings(false)}
                  className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground/80 font-medium text-xs hover:bg-transparent dark:hover:bg-card/5 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void saveWaConfig()}
                  disabled={waSavingConfig}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-transform active:scale-95 disabled:opacity-60"
                >
                  {waSavingConfig ? "Salvando..." : "Salvar Configuração"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
