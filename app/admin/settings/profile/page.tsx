"use client";
import {
  Loader2,
  Pencil,
  Settings,
  Target,
  TrendingUp,
  TrendingDown,
  ArrowRight,
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
// COMPONENTES UI
// ============================================================================

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
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

      
    }
    load();
  }, []);

  // polling WhatsApp removido — sessões gerenciadas na página /admin/whatsapp

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
    try {
      const norm = applyPhoneNormalization(phoneRaw);
      const { error } = await supabaseBrowser.from("profiles").upsert({
        id: userId,
        display_name: name,
        phone: norm.e164 || null,
        whatsapp_username: whatsappUsername || null,
        birth_date: birthDate || null,
        gender: gender || null,
        height: profileHeight ? parseFloat(profileHeight) : null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      if (norm.e164) {
        setPhonePrettyPrefix(norm.prettyPrefix);
        setPhoneRaw(norm.formattedNational || norm.nationalDigits || phoneRaw);
      }
      addToast("success", "Perfil salvo", "Dados cadastrais atualizados.");
      setIsEditing(false);
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSaving(false);
    }
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
      <div className="p-10 text-center text-muted-foreground animate-pulse bg-card border-border rounded-xl border m-6">
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
              className="h-9 w-9 shrink-0 rounded-xl border font-medium text-xs flex items-center justify-center bg-card border-border text-muted-foreground hover:bg-muted transition-all shadow-sm"
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
                <div className="absolute right-0 top-full mt-2 w-56 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-200">
                  {/* Tema */}
                  <div className="px-3 py-2.5 border-b border-border">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      Tema do Sistema
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setTheme("light");
                          setShowSettingsDropdown(false);
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${theme !== "dark" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`}
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
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${theme === "dark" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`}
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
                    className="w-full text-left px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted flex items-center gap-2.5 transition-colors border-b border-border"
                  >
                    <Pencil className="w-4 h-4" />
                    Editar Perfil
                  </button>

                  

                  {/* Exportar */}
                  <button
                    onClick={() => {
                      setShowSettingsDropdown(false);
                      setActionModal("export");
                    }}
                    className="w-full text-left px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted flex items-center gap-2.5 transition-colors border-b border-border"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Exportar Registros
                  </button>

                  {/* Importar */}
                  <button
                    onClick={() => {
                      setShowSettingsDropdown(false);
                      setActionModal("import");
                    }}
                    className="w-full text-left px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted flex items-center gap-2.5 transition-colors border-b border-border"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Importar Registros
                  </button>

                  {/* Templates */}
                  <button
                    onClick={() => {
                      setShowSettingsDropdown(false);
                      setActionModal("template");
                    }}
                    className="w-full text-left px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted flex items-center gap-2.5 transition-colors border-b border-border"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    Baixar Templates
                  </button>

                  {/* Alterar Senha */}
                  <button
                    onClick={() => {
                      setShowSettingsDropdown(false);
                      handleResetPassword();
                    }}
                    className="w-full text-left px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted flex items-center gap-2.5 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-muted-foreground">
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

      {/* CONTEÚDO PRINCIPAL CENTRALIZADO */}
      <div className="max-w-3xl mx-auto">
        <div className="space-y-6">
          {/* CARD 1: DADOS PESSOAIS (SEMPRE VISÍVEL) */}
          <div
            className={`bg-card border-y sm:border border-border sm:rounded-2xl p-4 sm:p-6 shadow-sm space-y-6 transition-all ${isEditing ? "ring-1 ring-emerald-500/20" : ""}`}
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
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
<div className="h-11 px-3 bg-transparent border border-border rounded-xl flex items-center text-xs font-medium text-foreground/90 truncate">
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
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">
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
                    className={`mt-1.5 flex items-center gap-1.5 text-[10px] font-medium ${waValidation.loading ? "text-muted-foreground" : waValidation.exists ? "text-emerald-500" : "text-rose-500"}`}
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
<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
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
                  <p className="text-[11px] text-amber-500 font-semibold">
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
className="flex-1 h-10 border border-border text-muted-foreground font-medium rounded-xl text-xs hover:bg-muted transition-colors"
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
                <div className="text-xs text-muted-foreground text-center py-6 bg-transparent rounded-xl border border-dashed border-border">
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
                            className={`items-center gap-3 p-3 rounded-xl border transition-colors group ${isNewest ? "border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_2px_8px_rgba(16,185,129,0.08)]" : "border-border bg-muted/30"} ${hideOnMobile ? "hidden xl:flex" : "flex"}`}
                          >
                            {/* Data em bloco */}
                            <div className="shrink-0 text-center w-10">
                              <p className="text-[9px] font-medium text-muted-foreground uppercase leading-none">
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
<p className="text-[9px] text-muted-foreground leading-none">
                                {new Date(
                                  record.date + "T12:00:00",
                                ).getFullYear()}
                              </p>
                            </div>
<div className="w-px h-9 bg-border shrink-0" />

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
                                <span className="text-[10px] font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
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
                                className="w-7 h-7 rounded-lg bg-card/5 border border-border flex items-center justify-center text-muted-foreground hover:text-amber-500 transition-colors"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleDeleteHealthRecord(record.id)
                                }
                                className="w-7 h-7 rounded-lg bg-card/5 border border-border flex items-center justify-center text-muted-foreground hover:text-rose-500 transition-colors"
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
                      className="w-full py-2.5 mt-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors bg-transparent rounded-xl border border-border"
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
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 mt-1">
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
                        <span className="text-[10px] font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full shrink-0">
                          <Target className="w-4 h-4 inline-block mr-1.5 text-emerald-500" />{" "}
                          Peso ideal: {idealWMin}–{idealWMax} kg · IMC 18,5–24,9
                        </span>
                      )}
                    </div>
                    <div className="w-full overflow-x-auto rounded-xl border border-border bg-card">
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
                                <ArrowRight className="w-4 h-4 inline-block text-muted-foreground" />
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
                                <div className="bg-card border border-border rounded-xl shadow-xl px-3 py-2.5 space-y-1.5 min-w-[180px]">
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
                                            ? "text-emerald-500"
                                            : diffFirst > 0
                                              ? "text-rose-500"
                                              : "text-muted-foreground"
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
                                            ? "text-emerald-500"
                                            : diffPrev > 0
                                              ? "text-rose-500"
                                              : "text-muted-foreground"
                                        }
                                      >
                                        {diffPrev > 0 ? "+" : ""}
                                        {diffPrev} kg
                                      </b>{" "}
                                      vs anterior ({fmtFull(prev!.date)})
                                    </p>
                                  )}
                                  {hoveredPt.i === 0 && (
                                    <p className="text-[10px] text-muted-foreground italic">
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
      </div>

      {/* inputs ocultos para import */}
      <input ref={importFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); }} />
      <input ref={importAppsFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportAppsFile(f); }} />
      <input ref={importAutoFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportAutoFile(f); }} />
      <input ref={importResellerFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportResellerFile(f); }} />
      <input ref={importMessageFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportMessageFile(f); }} />
      <input ref={importServerFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportServerFile(f); }} />
      <input ref={importFinanceiroFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFinanceiroFile(f); }} />

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
                  className="w-full text-left text-xs p-3 font-semibold rounded-lg border border-border bg-transparent hover:bg-muted text-foreground/90 transition-colors flex items-center gap-2"
                >
                  <span>{item.icon}</span> {item.n}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setActionModal(null)}
              className="w-full text-center text-xs font-medium text-muted-foreground mt-2 hover:text-foreground"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      
    </div>
  );
}