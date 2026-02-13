"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "../ToastNotifications";

// --- TIPOS ---

type SelectOption = {
  id: string;
  name: string;
};

export type ClientData = {
  id?: string;
  client_name: string;
  username: string;
  server_password?: string;

  whatsapp_e164?: string;
  whatsapp_username?: string;
  whatsapp_extra?: string[];
  whatsapp_opt_in?: boolean;
  dont_message_until?: string;

  server_id: string;
  screens: number;

  notes?: string;

  plan_name?: string;
  price_amount?: number;
  price_currency?: string;

  // ✅ NOVO (fonte da verdade)
  plan_table_id?: string | null;

  // ✅ OPCIONAL (se você trouxer na view/join)
  plan_table_name?: string | null;

  vencimento?: string; // timestamptz
  apps_names?: string[];
  technology?: string;
};


type ModalMode = "client" | "trial";

interface Props {
  clientToEdit?: ClientData | null;
  mode?: ModalMode;
  initialTab?: "dados" | "pagamento" | "apps"; // ✅ NOVO: iniciar em uma aba específica
  onClose: () => void;
  onSuccess: () => void;
}


// ===== PLAN TABLES =====
type Currency = "BRL" | "USD" | "EUR";

interface PlanTableItemPrice {
  screens_count: number;
  price_amount: number | null;
}

interface PlanTableItem {
  id: string;
  period: string;
  credits_base: number;
  prices: PlanTableItemPrice[];
}

interface PlanTable {
  id: string;
  name: string;
  currency: Currency;
  is_system_default?: boolean | null;
  items: PlanTableItem[];
}

const PLAN_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};
const PLAN_MONTHS: Record<string, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

// --- HELPERS ---
function onlyDigits(raw: string) {
  return raw.replace(/\D+/g, "");
}

function normalizeE164(raw: string) {
  const digits = onlyDigits(raw);
  return digits ? `+${digits}` : "";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localDateTimeToISO(local: string): string | null {
  // local esperado: "YYYY-MM-DDTHH:mm" (datetime-local)
  if (!local) return null;

  const [datePart, timePart] = local.split("T");
  if (!datePart || !timePart) return null;

  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);

  if (![y, m, d, hh, mm].every((n) => Number.isFinite(n))) return null;

  // Cria como horário LOCAL (São Paulo, se o sistema estiver em SP)
  const dt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  return dt.toISOString(); // salva em UTC, correto
}

function isoToLocalDateTimeInputValue(iso: string): string {
  if (!iso) return "";

  const dt = new Date(iso);
  const ms = dt.getTime();

  // inválido
  if (!Number.isFinite(ms)) return "";

  // ✅ ignora epoch / sentinela (qualquer coisa antes de 2001, por segurança)
  // (se quiser mais agressivo, usa < 1 dia após 1970)
  if (dt.getUTCFullYear() < 2001) return "";

  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  return dt.toISOString().slice(0, 16);
}



function getLocalISOString() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16); // yyyy-mm-ddThh:mm
}

function fmtMoney(currency: string, n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
  }).format(n);
}

function safeNumberFromMoneyBR(s: string) {
  return Number(String(s || "0").replace(/\./g, "").replace(",", ".")) || 0;
}

function toBRDate(dateISO: string) {
  if (!dateISO) return "";
  const [y, m, d] = dateISO.split("-");
  return `${d}/${m}/${y}`;
}

// --- DDI ---
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
{ code: "52", label: "México", flag: "🇲🇽" },
{ code: "54", label: "Argentina", flag: "🇦🇷" },
{ code: "56", label: "Chile", flag: "🇨🇱" },
{ code: "57", label: "Colômbia", flag: "🇨🇴" },
{ code: "58", label: "Venezuela", flag: "🇻🇪" },

// Europa
{ code: "32", label: "Bélgica", flag: "🇧🇪" },
{ code: "46", label: "Suécia", flag: "🇸🇪" },
{ code: "31", label: "Holanda", flag: "🇳🇱" },
{ code: "41", label: "Suíça", flag: "🇨🇭" },
{ code: "45", label: "Dinamarca", flag: "🇩🇰" },
{ code: "48", label: "Polônia", flag: "🇵🇱" },
{ code: "30", label: "Grécia", flag: "🇬🇷" },

// América
{ code: "507", label: "Panamá", flag: "🇵🇦" },
{ code: "506", label: "Costa Rica", flag: "🇨🇷" },
{ code: "595", label: "Paraguai", flag: "🇵🇾" },
{ code: "591", label: "Bolívia", flag: "🇧🇴" },
{ code: "503", label: "El Salvador", flag: "🇸🇻" },
{ code: "502", label: "Guatemala", flag: "🇬🇹" },
{ code: "504", label: "Honduras", flag: "🇭🇳" },

// África
{ code: "27", label: "África do Sul", flag: "🇿🇦" },
{ code: "234", label: "Nigéria", flag: "🇳🇬" },
{ code: "254", label: "Quênia", flag: "🇰🇪" },
{ code: "20", label: "Egito", flag: "🇪🇬" },
{ code: "212", label: "Marrocos", flag: "🇲🇦" },
{ code: "233", label: "Gana", flag: "🇬🇭" },
{ code: "229", label: "Benin", flag: "🇧🇯" },

// Ásia
{ code: "86", label: "China", flag: "🇨🇳" },
{ code: "91", label: "Índia", flag: "🇮🇳" },
{ code: "81", label: "Japão", flag: "🇯🇵" },
{ code: "82", label: "Coreia do Sul", flag: "🇰🇷" },
{ code: "66", label: "Tailândia", flag: "🇹🇭" },
{ code: "62", label: "Indonésia", flag: "🇮🇩" },
{ code: "60", label: "Malásia", flag: "🇲🇾" },
{ code: "970", label: "Palestina", flag: "🇵🇸" },

// Oriente Médio
{ code: "971", label: "Emirados Árabes", flag: "🇦🇪" },
{ code: "966", label: "Arábia Saudita", flag: "🇸🇦" },
{ code: "98", label: "Irã", flag: "🇮🇷" },
{ code: "90", label: "Turquia", flag: "🇹🇷" },
{ code: "964", label: "Iraque", flag: "🇮🇶" },

// Oceania
{ code: "61", label: "Austrália", flag: "🇦🇺" },
{ code: "64", label: "Nova Zelândia", flag: "🇳🇿" },
{ code: "672", label: "Ilhas Norfolk", flag: "🇳🇫" },

// Caribe / NANP extras
{ code: "1246", label: "Barbados", flag: "🇧🇧" },
{ code: "1441", label: "Bermudas", flag: "🇧🇲" },
{ code: "1242", label: "Bahamas", flag: "🇧🇸" },
{ code: "1868", label: "Trinidad e Tobago", flag: "🇹🇹" },
{ code: "1649", label: "Ilhas Turcas e Caicos", flag: "🇹🇨" },
{ code: "1473", label: "Granada", flag: "🇬🇩" },
{ code: "1268", label: "Antígua e Barbuda", flag: "🇦🇬" },
{ code: "1784", label: "São Vicente e Granadinas", flag: "🇻🇨" },
{ code: "1664", label: "Montserrat", flag: "🇲🇸" },
{ code: "1869", label: "São Cristóvão e Névis", flag: "🇰🇳" },
{ code: "1758", label: "Santa Lúcia", flag: "🇱🇨" },
];

function inferDDIFromDigits(allDigits: string): string {
  const digits = onlyDigits(allDigits || "");
  if (!digits) return "55";
  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) {
    if (digits.startsWith(opt.code)) return opt.code;
  }
  return "55";
}

function ddiMeta(ddi: string) {
  const opt = DDI_OPTIONS.find((o) => o.code === ddi);
  if (!opt) return { label: `+${ddi}`, pretty: `+${ddi}` };
  return { label: `${opt.label} (+${opt.code})`, pretty: `${opt.flag} ${opt.label} (+${opt.code})` };
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

function splitE164(raw: string) {
  const digits = onlyDigits(raw);
  const ddi = inferDDIFromDigits(digits);
  const national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
  return { ddi, national };
}

function clientTableLabelFromRow(
  client: ClientData | null | undefined,
  tables: PlanTable[]
) {
  if (!client) return "—";

  // 1) se já veio o nome da tabela do banco, usa ele e pronto
  const name = (client.plan_table_name || "").trim();
  if (name) return name;

  // 2) senão, tenta pelo ID
  const id = client.plan_table_id || "";
  if (id) {
    const t = tables.find((x) => x.id === id);
    if (t) return formatTableLabel(t);
  }

  // 3) fallback neutro (NUNCA “Tabela Geral”)
  return "—";
}


function formatTableLabel(t: PlanTable) {
  const currency = t.currency || "BRL";
  const raw = (t.name || "").trim();
  const isDefaultByName = raw.toLowerCase().startsWith("padr") || raw.toLowerCase().startsWith("default");
  const isDefault = Boolean(t.is_system_default) || isDefaultByName;

  if (isDefault) {
    const firstWord = raw.split(/\s+/)[0] || "Padrão";
    return `${firstWord} ${currency}`;
  }
  return `${raw} ${currency}`;
}

function pickPriceFromTable(table: PlanTable | null, period: string, screens: number) {
  if (!table) return null;
  const item = table.items?.find((i) => i.period === period);
  if (!item) return null;

  const exact = item.prices?.find((p) => p.screens_count === screens);
  if (exact && exact.price_amount != null) return Number(exact.price_amount);

  const one = item.prices?.find((p) => p.screens_count === 1);
  if (one && one.price_amount != null) return Number(one.price_amount) * screens;

  return 0;
}

function pickCreditsUsed(table: PlanTable | null, period: string, screens: number) {
  if (!table) return null;
  const item = table.items?.find((i) => i.period === period);
  if (!item) return null;

  const base = Number(item.credits_base || 0);
  const used = base * Math.max(1, Number(screens || 1));
  return { base, used };
}

// --- UI helpers ---
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
      {children}
    </label>
  );
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors dark:[color-scheme:dark] ${className}`}
    />
  );
}

function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-700 dark:text-white/70">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-7 rounded-full transition-colors border ${
          checked
            ? "bg-emerald-600 border-emerald-600"
            : "bg-slate-200 dark:bg-white/10 border-slate-300 dark:border-white/10"
        }`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function PhoneRow({
  label,
  countryLabel,
  rawValue,
  onRawChange,
  onDone,
  onRemove,
  showRemove,
}: {
  label: string;
  countryLabel: string;
  rawValue: string;
  onRawChange: (v: string) => void;
  onDone: () => void;
  onRemove?: () => void;
  showRemove?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <div className="h-10 min-w-[160px] px-3 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-xs font-bold text-slate-700 dark:text-white">
          {countryLabel || "—"}
        </div>

        <div className="relative flex-1">
          <Input
            value={rawValue}
            onChange={(e) => onRawChange(e.target.value)}
            placeholder="Telefone"
            className="pr-12"
          />
          <button
            type="button"
            onClick={onDone}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center justify-center"
            title="Normalizar"
          >
            ✓
          </button>
        </div>

        {showRemove && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="h-10 px-3 rounded-lg border border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
            title="Remover"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function queueListToast(
  mode: "client" | "trial",
  toast: { type: "success" | "error"; title: string; message?: string }
) {
  try {
    if (typeof window === "undefined") return;

    const key = mode === "trial" ? "trials_list_toasts" : "clients_list_toasts";
    const raw = window.sessionStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as any[]) : [];
    arr.push({
      type: toast.type,
      title: toast.title,
      message: toast.message,
      ts: Date.now(),
    });
    window.sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {
    // silencioso
  }
}

export default function NovoCliente({ clientToEdit, mode = "client", initialTab, onClose, onSuccess }: Props) {
  // Bloqueia scroll do fundo
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);
  const isEditing = !!clientToEdit;
  const isTrialMode = mode === "trial";


    const [activeTab, setActiveTab] = useState<"dados" | "pagamento" | "apps">(initialTab || "dados");

      useEffect(() => {
    if (!initialTab) return;
    setActiveTab(initialTab);
  }, [initialTab]);


  const [loading, setLoading] = useState(false);
  const [fetchingAux, setFetchingAux] = useState(true);

  // --- TOAST STATE ---
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const TOAST_DURATION = 5000;
  const toastSeq = useRef(1);

    // ✅ trava para não resetar override durante o prefill inicial
  const didInitRef = useRef(false);

  const addToast = (type: "success" | "error", title: string, message?: string) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    setToasts((prev) => [
      ...prev,
      { id, type, title, message, durationMs: TOAST_DURATION },
    ]);
  };

  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // --- AUX ---
  const [servers, setServers] = useState<SelectOption[]>([]);
  const [allApps, setAllApps] = useState<SelectOption[]>([]);

  // plan tables
  const [tables, setTables] = useState<PlanTable[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>("");

  const selectedTable = useMemo(() => {
    return tables.find((t) => t.id === selectedTableId) || null;
  }, [tables, selectedTableId]);

  // --- DADOS (TAB 1) ---
  const [salutation, setSalutation] = useState<string>("");
  const [name, setName] = useState("");

  const [createdAt, setCreatedAt] = useState<string>(() => getLocalISOString());

  const [primaryPhoneRaw, setPrimaryPhoneRaw] = useState("");
  const [primaryCountryLabel, setPrimaryCountryLabel] = useState<string>(ddiMeta("55").label);

  const [whatsappUsername, setWhatsappUsername] = useState("");
  const [whatsUserTouched, setWhatsUserTouched] = useState(false);

  const [extras, setExtras] = useState<{ id: number; raw: string; countryLabel: string }[]>([]);

  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [dontMessageUntil, setDontMessageUntil] = useState<string>("");

  // --- PAGAMENTO (TAB 2) ---
  const [serverId, setServerId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // ✅ NOVO: Tecnologia
  const [technology, setTechnology] = useState("IPTV");
  const [customTechnology, setCustomTechnology] = useState("");

  const [selectedPlanPeriod, setSelectedPlanPeriod] = useState<keyof typeof PLAN_LABELS>("MONTHLY");
  const [screens, setScreens] = useState(1);

  const [currency, setCurrency] = useState<Currency>("BRL");
  const [planPrice, setPlanPrice] = useState("0,00");
  const [priceTouched, setPriceTouched] = useState(false);

  // ✅ VENCIMENTO DATA + HORA
  // Inicialização para NOVO CLIENTE: Data de hoje e HORA ATUAL DO SISTEMA
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  });
  const [dueTime, setDueTime] = useState(() => {
    const d = new Date();
    // Inicia com a hora atual (ex: 16:20) em vez de 23:59 fixo
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  });

  const [registerRenewal, setRegisterRenewal] = useState(false);
  const [sendPaymentMsg, setSendPaymentMsg] = useState(false);

  useEffect(() => {
    if (isEditing) return;
    if (registerRenewal) {
      setSendPaymentMsg(true);
    } else {
      setSendPaymentMsg(false);
    }
  }, [registerRenewal, isEditing]);

  const [fxRate, setFxRate] = useState<number>(1);
  const [totalBrl, setTotalBrl] = useState<number>(0);

  // ✅ NOVO: Controle do Popup de Confirmação Bonito
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; title: string; details: string[] } | null>(null);

  // --- TIPOS PARA APPS DINÂMICOS ---
  type AppCatalog = { id: string; name: string; fields_config: any[]; info_url: string | null };
  type SelectedAppInstance = { 
  instanceId: string; 
  app_id: string; 
  name: string; 
  values: Record<string, string>; 
  fields_config: any[];
  // ✅ Novos campos de controle por instância
  costType: "paid" | "free" | "partnership";
  partnerServerId: string;
  is_minimized?: boolean; // ✅ NOVO
};

// --- ESTADOS ---
  const [catalog, setCatalog] = useState<AppCatalog[]>([]);
  const [selectedApps, setSelectedApps] = useState<SelectedAppInstance[]>([]);
  const [showAppSelector, setShowAppSelector] = useState(false);
  const [appSearch, setAppSearch] = useState(""); // ✅ NOVO: Controle da busca
  const [notes, setNotes] = useState("");

  // ===== NORMALIZAÇÃO TELEFONE =====
  function applyPhoneNormalization(rawInput: string) {
    const rawDigits = onlyDigits(rawInput);
    if (!rawDigits) {
      return {
        countryLabel: "—",
        e164: "",
        nationalDigits: "",
        formattedNational: "",
      };
    }

    const ddi = inferDDIFromDigits(rawDigits);
    const meta = ddiMeta(ddi);
    const nationalDigits = rawDigits.startsWith(ddi) ? rawDigits.slice(ddi.length) : rawDigits;
    const formattedNational = formatNational(ddi, nationalDigits);
    const e164 = `+${ddi}${nationalDigits}`;

    return {
      countryLabel: meta.label,
      e164,
      nationalDigits,
      formattedNational,
    };
  }

  function handleDonePrimary() {
    const norm = applyPhoneNormalization(primaryPhoneRaw);
    setPrimaryCountryLabel(norm.countryLabel);
    setPrimaryPhoneRaw(norm.formattedNational || norm.nationalDigits || primaryPhoneRaw);
    if (!whatsUserTouched) {
      setWhatsappUsername(onlyDigits(norm.e164));
    }
  }

  function handleDoneExtra(id: number) {
    setExtras((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        const norm = applyPhoneNormalization(x.raw);
        return {
          ...x,
          countryLabel: norm.countryLabel,
          raw: norm.formattedNational || norm.nationalDigits || x.raw,
        };
      })
    );
  }

  // ======= LOAD AUX + EDIT PREFILL =======
  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const tid = await getCurrentTenantId();

        // 1. Servidores
        const srvRes = await supabaseBrowser
          .from("servers")
          .select("id, name")
          .eq("tenant_id", tid)
          .eq("is_archived", false);

        // 2. Apps (Catálogo Completo com Configuração)
        // Buscamos apenas na tabela 'apps' nova que configuramos
        const { data: appsData, error: appsErr } = await supabaseBrowser
          .from("apps")
          .select("id, name, fields_config, info_url")
          .eq("tenant_id", tid)
          .eq("is_active", true);

        if (appsErr) {
          console.warn("Erro ao carregar catálogo de apps:", appsErr.message);
        }

        // 3. Tabelas de Preço
        const tRes = await supabaseBrowser
          .from("plan_tables")
          .select(
            `id, name, currency, is_system_default,
             items:plan_table_items (id, period, credits_base, prices:plan_table_item_prices (screens_count, price_amount))`
          )
          .eq("tenant_id", tid)
          .eq("is_active", true);

        if (!alive) return;

        // Setters de Auxiliares
        if (srvRes.data) {
          setServers(srvRes.data.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
        }

        if (appsData) {
          // Guardamos o catálogo completo para usar no seletor
          setCatalog(appsData);
          // Opcional: Se ainda usa allApps para algo legado, pode manter, senão pode ignorar
          setAllApps(appsData.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })));
        }

        const allTables = (tRes.data || []) as unknown as PlanTable[];
        setTables(allTables);

        // Define Tabela Padrão (BRL)
        const defaultBRL =
          allTables.find((t) => t.currency === "BRL" && t.is_system_default) ||
          allTables.find((t) => t.currency === "BRL") ||
          allTables[0];

        // ✅ 1) define qual tabela deve ficar selecionada
        // ✅ prioridade absoluta: tabela do cliente (se existir/ativa)
        const clientTableId = (clientToEdit as any)?.plan_table_id || "";
        const clientTableExists = clientTableId ? allTables.some((t) => t.id === clientTableId) : false;

        let initialTableId = clientTableExists
          ? clientTableId
          : (defaultBRL?.id || allTables[0]?.id || "");


        // ✅ aplica a seleção inicial
        if (initialTableId) {
          setSelectedTableId(initialTableId);

          const t0 = allTables.find((t) => t.id === initialTableId) || defaultBRL || null;
          if (t0) {
            setCurrency(t0.currency || "BRL");

            // preço inicial só “auto” se o usuário não tiver sobrescrito
            // (na edição, seu priceTouched vira true se tiver price_amount)
            const p = pickPriceFromTable(t0, "MONTHLY", 1);
            setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
            setPriceTouched(false);
          }
        }

        if (isTrialMode && defaultBRL) {
          setSelectedTableId(defaultBRL.id);
          setCurrency("BRL");
          setSelectedPlanPeriod("MONTHLY");
          setScreens(1);
          const p = pickPriceFromTable(defaultBRL, "MONTHLY", 1);
          setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
          setPriceTouched(false);
        }

        // ===== PREFILL EDIÇÃO =====
if (clientToEdit) {
  setName((clientToEdit.client_name || "").trim());

  // ✅ TABELA DO CLIENTE (prefill)
  // prioridade absoluta: plan_table_id do cliente, se existir e estiver na lista "tables"
  const clientPlanTableId = (clientToEdit as any)?.plan_table_id || null;
if (clientPlanTableId) {
  const exists = allTables.some((t) => t.id === clientPlanTableId);
  if (exists) {
    setSelectedTableId(clientPlanTableId);
    const tSel = allTables.find((t) => t.id === clientPlanTableId) || null;
    if (tSel) setCurrency(tSel.currency || "BRL");
  }
}


  // Tecnologia
  const tec = clientToEdit.technology || "IPTV";
  if (["IPTV", "P2P", "OTT"].includes(tec)) {
    setTechnology(tec);
    setCustomTechnology("");
  } else {
    setTechnology("Personalizado");
    setCustomTechnology(tec);
  }

  setUsername(clientToEdit.username || "");
  setPassword(clientToEdit.server_password || "");

  // Telefones
  if (clientToEdit.whatsapp_e164) {
    const { ddi, national } = splitE164(clientToEdit.whatsapp_e164);
    setPrimaryCountryLabel(ddiMeta(ddi).label);
    setPrimaryPhoneRaw(formatNational(ddi, national) || national);
    if (!whatsUserTouched) {
      setWhatsappUsername(
        clientToEdit.whatsapp_username || onlyDigits(clientToEdit.whatsapp_e164)
      );
    }
  }

  if (Array.isArray(clientToEdit.whatsapp_extra)) {
    setExtras(
      clientToEdit.whatsapp_extra.map((ph, i) => {
        const { ddi, national } = splitE164(ph);
        return {
          id: i + 1,
          raw: formatNational(ddi, national) || national,
          countryLabel: ddiMeta(ddi).label,
        };
      })
    );
  }

  setServerId(clientToEdit.server_id || "");
  setScreens(clientToEdit.screens || 1);

  // Plano e Preço
  const pName = (clientToEdit.plan_name || "").toUpperCase();
  let foundPeriod: keyof typeof PLAN_LABELS = "MONTHLY";
  if (pName.includes("ANUAL")) foundPeriod = "ANNUAL";
  else if (pName.includes("SEMESTRAL")) foundPeriod = "SEMIANNUAL";
  else if (pName.includes("TRIMESTRAL")) foundPeriod = "QUARTERLY";
  else if (pName.includes("BIMESTRAL")) foundPeriod = "BIMONTHLY";
  setSelectedPlanPeriod(foundPeriod);

  // ✅ Se tiver override de preço, mantém como estava
  if (clientToEdit.price_amount != null) {
    setPlanPrice(Number(clientToEdit.price_amount).toFixed(2).replace(".", ","));
    setPriceTouched(true);
    } else {
    // ✅ Se NÃO tiver override, recalcula pelo preço da TABELA DO CLIENTE
    // ⚠️ IMPORTANTE: aqui ainda estamos dentro do load() — use allTables (local), não `tables` (state)
    const currentTableId =
      clientPlanTableId && allTables.some((t) => t.id === clientPlanTableId)
        ? clientPlanTableId
        : (initialTableId || "");


    const tSel = allTables.find((t) => t.id === currentTableId) || null;
    if (tSel) {
      const pAuto = pickPriceFromTable(tSel, foundPeriod, clientToEdit.screens || 1);
      setPlanPrice(Number(pAuto || 0).toFixed(2).replace(".", ","));
      setPriceTouched(false);
      setCurrency(tSel.currency || "BRL");
    }
  }


  // Câmbio
  if (clientToEdit.price_currency) {
    const ccy = clientToEdit.price_currency as Currency;
    if (ccy !== "BRL") {
      const { data: fx, error: fxErr } = await supabaseBrowser
        .from("tenant_fx_rates")
        .select("usd_to_brl, eur_to_brl, as_of_date")
        .eq("tenant_id", tid)
        .order("as_of_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fxErr) {
        console.error("tenant_fx_rates error:", fxErr);
        setFxRate(5);
      } else {
        const rate =
          ccy === "USD"
            ? Number(fx?.usd_to_brl || 5)
            : Number(fx?.eur_to_brl || 5);
        setFxRate(rate);
      }
    } else {
      setFxRate(1);
    }
  }

  // Data Vencimento
  if (clientToEdit.vencimento) {
    const dt = new Date(clientToEdit.vencimento);
    const dISO = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
    const tISO = `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
    setDueDate(dISO);
    setDueTime(tISO);
  }

  setWhatsappOptIn(clientToEdit.whatsapp_opt_in ?? true);

  if (clientToEdit.dont_message_until) {
    const v = isoToLocalDateTimeInputValue(clientToEdit.dont_message_until);
    setDontMessageUntil(v);
  } else {
    setDontMessageUntil("");
  }

  setNotes(clientToEdit.notes || "");  // ✅ OBSERVAÇÕES: não confiar no clientToEdit vindo da view/lista
  // (muitas views não trazem notes, aí parece que "sumiu")
  try {
    if (clientToEdit.id) {
      const { data: nrow, error: nerr } = await supabaseBrowser
        .from("clients")
        .select("notes")
        .eq("tenant_id", tid)
        .eq("id", clientToEdit.id)
        .maybeSingle();

      if (!nerr) {
        setNotes((nrow?.notes || "").toString());
      } else {
        setNotes(clientToEdit.notes || "");
      }
    } else {
      setNotes(clientToEdit.notes || "");
    }
  } catch {
    setNotes(clientToEdit.notes || "");
  }


  // ✅ CARREGAMENTO DE APPS (NOVA LÓGICA)
  if (clientToEdit.id) {
    const { data: currentApps } = await supabaseBrowser
      .from("client_apps")
      .select("app_id, field_values, apps(name, fields_config)")
      .eq("client_id", clientToEdit.id);

    if (currentApps) {
      const instances = currentApps.map((ca: any) => {
        const savedValues = ca.field_values || {};
        const { _config_cost, _config_partner, ...restValues } = savedValues;

      return {
        instanceId: crypto.randomUUID(),
        app_id: ca.app_id,
        name: ca.apps?.name || "App Removido",
        values: restValues,
        fields_config: Array.isArray(ca.apps?.fields_config) ? ca.apps?.fields_config : [],
        costType: _config_cost || "paid",
        partnerServerId: _config_partner || "",
        is_minimized: true // ✅ Garante que apps já salvos iniciem fechados na edição
      };
      });
      setSelectedApps(instances);
    }
  }

  // Tecnologia (Fallback)
  const tecRaw = clientToEdit.technology || "IPTV";
  const isStandard = ["IPTV", "P2P", "OTT"].some((t) => t.toUpperCase() === tecRaw.toUpperCase());
  if (isStandard) {
    setTechnology(tecRaw.toUpperCase());
    setCustomTechnology("");
  } else {
    setTechnology("Personalizado");
    setCustomTechnology(tecRaw);
  }
}

      } catch (err) {
        console.error(err);
      } finally {
        // ✅ daqui pra frente, qualquer mudança em telas/plano/tabela já é "interação" (ou pós-prefill)
        didInitRef.current = true;

        if (alive) setFetchingAux(false);
      }

    }

    load();
    return () => {
      alive = false;
    };
  }, [clientToEdit]); // eslint-disable-line react-hooks/exhaustive-deps

    // ======= REGRAS =======

  useEffect(() => {
    const monthsToAdd = PLAN_MONTHS[selectedPlanPeriod] || 1;

    if (registerRenewal) {
      const base = new Date();
      const target = new Date(base);
      target.setMonth(target.getMonth() + monthsToAdd);

      const dISO = `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`;
      setDueDate(dISO);
    }

    // ✅ NÃO recalcula preço aqui (deixa isso só nos effects de preço)
  }, [selectedPlanPeriod, registerRenewal]);

  // 1) Se mudar a estrutura (Telas, Tabela, Periodo), reseta o override
  // ✅ mas só DEPOIS do prefill inicial terminar (senão apaga override ao abrir edição)
  useEffect(() => {
    if (!didInitRef.current) return;
    setPriceTouched(false);
  }, [screens, selectedPlanPeriod, selectedTableId]);

  // 2) Calcula o preço AUTOMÁTICO quando não tem override
  useEffect(() => {
    if (!selectedTable) return;
    if (priceTouched) return;

    const p = pickPriceFromTable(selectedTable, selectedPlanPeriod, Number(screens) || 1);
    setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
  }, [screens, selectedTable, selectedPlanPeriod, priceTouched]);

  // 3) Sempre que trocar a tabela, atualiza moeda + câmbio
  useEffect(() => {
    if (!selectedTable) return;

    setCurrency(selectedTable.currency || "BRL");

    (async () => {
      try {
        const tid = await getCurrentTenantId();

        if (selectedTable.currency === "BRL") {
          setFxRate(1);
          return;
        }

        const { data: fx, error: fxErr } = await supabaseBrowser
          .from("tenant_fx_rates")
          .select("usd_to_brl, eur_to_brl, as_of_date")
          .eq("tenant_id", tid)
          .order("as_of_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fxErr) {
          addToast("error", "Falha ao carregar câmbio", fxErr.message);
          setFxRate(5);
          return;
        }

        const rate =
          selectedTable.currency === "USD"
            ? Number(fx?.usd_to_brl || 5)
            : Number(fx?.eur_to_brl || 5);

        setFxRate(rate);
      } catch (e: any) {
        console.error("Crash FX:", e);
        setFxRate(5);
      }
    })();
  }, [selectedTableId, selectedTable]); // ✅ aqui é só troca de tabela/moeda/câmbio



  useEffect(() => {
    const rawVal = safeNumberFromMoneyBR(planPrice);
    setTotalBrl(currency === "BRL" ? rawVal : rawVal * (Number(fxRate) || 0));
  }, [planPrice, fxRate, currency]);

  const creditsInfo = useMemo(() => {
    return pickCreditsUsed(selectedTable, selectedPlanPeriod, screens);
  }, [selectedTable, selectedPlanPeriod, screens]);

  const showFx = currency !== "BRL";

  const tableLabel = clientTableLabelFromRow(clientToEdit, tables);



// Adiciona uma nova instância de app ao cliente
function addAppToClient(app: AppCatalog) {
    const newInstance: SelectedAppInstance = {
      instanceId: crypto.randomUUID(),
      app_id: app.id,
      name: app.name,
      fields_config: Array.isArray(app.fields_config) ? app.fields_config : [], // ✅ Blindagem contra erro
      values: {},
      costType: "paid", // Padrão: Pago
      partnerServerId: "",
      is_minimized: true // ✅ Inicia minimizado para não ocupar tela
    };
    setSelectedApps(prev => [...prev, newInstance]);
    setShowAppSelector(false);
  }

  // ✅ Nova função para atualizar Custo/Parceria
  function updateAppConfig(instanceId: string, key: "costType" | "partnerServerId", value: string) {
    setSelectedApps(prev => prev.map(app => {
        if (app.instanceId !== instanceId) return app;
        
        // Se mudou servidor e tem servidor, sugere parceria. Se tirou servidor, volta pra pago.
        if (key === "partnerServerId") {
             const newCost = value ? "partnership" : (app.costType === "partnership" ? "paid" : app.costType);
             return { ...app, partnerServerId: value, costType: newCost as any };
        }
        return { ...app, [key]: value };
    }));
  }

  function updateAppFieldValue(instanceId: string, fieldLabel: string, value: string) {
    setSelectedApps(prev => prev.map(app => {
      if (app.instanceId !== instanceId) return app;
      return { ...app, values: { ...app.values, [fieldLabel]: value } };
    }));
  }

  // 1. EXECUTA A GRAVAÇÃO REAL (Chamada direta ou pelo botão do Popup)
  async function executeSave() {
    setConfirmModal(null); // Fecha o popup se estiver aberto
    setLoading(true);

    try {
      // Recalcula variáveis necessárias para o envio (garante dados frescos)
      const tid = await getCurrentTenantId();
      
      const rawPrimaryDigits = onlyDigits(primaryPhoneRaw);
      const ddi = inferDDIFromDigits(rawPrimaryDigits);
      const nationalDigits = rawPrimaryDigits.startsWith(ddi) ? rawPrimaryDigits.slice(ddi.length) : rawPrimaryDigits;
      const finalPrimaryE164 = rawPrimaryDigits ? `+${ddi}${nationalDigits}` : "";

      const finalExtrasE164 = extras
        .map((e) => {
          const d = onlyDigits(e.raw);
          if (!d) return "";
          const ddi2 = inferDDIFromDigits(d);
          const nat2 = d.startsWith(ddi2) ? d.slice(ddi2.length) : d;
          return `+${ddi2}${nat2}`;
        })
        .filter((x) => x.length > 8);

        const rawSnooze = (dontMessageUntil || "").trim();
        const parsedSnoozeISO = rawSnooze ? localDateTimeToISO(rawSnooze) : null;

        const hasFutureSnooze = (() => {
          if (!parsedSnoozeISO) return false;
          const ms = new Date(parsedSnoozeISO).getTime();
          return Number.isFinite(ms) && ms > Date.now();
        })();

        const snoozeISO = hasFutureSnooze ? parsedSnoozeISO : null;
        const clearSnooze = !hasFutureSnooze;



      const dueLocal = new Date(`${dueDate}T${dueTime}:00`);
      const dueISO = dueLocal.toISOString();
      
      const displayName = name.trim();
      const namePrefix = salutation?.trim() ? salutation.trim() : null;

      let finalTechnology = technology;
      if (technology === "Personalizado") finalTechnology = customTechnology.trim();

      // Dados do RPC
      const { data: userRes } = await supabaseBrowser.auth.getUser();
      const createdBy = userRes?.user?.id;

      const rpcTable = isTrialMode ? (tables.find(t=>t.currency==="BRL"&&t.is_system_default)||tables[0]) : selectedTable;
      const rpcPeriod = (isTrialMode ? "MONTHLY" : selectedPlanPeriod) as any;
      const rpcScreens = isTrialMode ? 1 : Number(screens || 1);
      const priceFromTable = pickPriceFromTable(rpcTable, rpcPeriod, rpcScreens) ?? 0;
      const rpcPriceAmount = isTrialMode ? Number(priceFromTable) : safeNumberFromMoneyBR(planPrice);
      const rpcCurrency = isTrialMode ? "BRL" : (currency || "BRL");
      const rpcPlanLabel = isTrialMode ? PLAN_LABELS["MONTHLY"] : PLAN_LABELS[selectedPlanPeriod];

      let clientId = clientToEdit?.id;

      // === BLOCO ORIGINAL DE GRAVAÇÃO ===
      if (isEditing && clientId) {
        // --- ATUALIZAÇÃO ---
const { error } = await supabaseBrowser.rpc("update_client", {
  p_tenant_id: tid,
  p_client_id: clientId,
  p_display_name: displayName,
  p_server_id: serverId,
  p_server_username: username,
  p_server_password: password?.trim() || "",
  p_screens: rpcScreens,
  p_plan_label: rpcPlanLabel,
  p_plan_table_id: selectedTableId || null, // ✅ Garante envio explícito do ID da tabela
  p_price_amount: rpcPriceAmount,
  p_price_currency: rpcCurrency as any,
  p_vencimento: dueISO,
  p_notes: notes?.trim() ? notes.trim() : null,
  p_clear_notes: Boolean(isEditing && !notes?.trim()),

  p_whatsapp_username: whatsappUsername || null,
  p_whatsapp_opt_in: Boolean(whatsappOptIn),
  p_whatsapp_snooze_until: snoozeISO,
  p_clear_whatsapp_snooze_until: clearSnooze, // ✅ NOVO
  p_is_trial: isTrialMode,
  p_name_prefix: namePrefix,
  p_technology: finalTechnology,
  
});


        if (error) {
          addToast("error", "Erro ao atualizar", error.message);
          throw error;
        }

        // Atualiza Telefones
        await supabaseBrowser.rpc("set_client_phones", {
          p_tenant_id: tid,
          p_client_id: clientId,
          p_primary_e164: finalPrimaryE164,
          p_secondary_e164: finalExtrasE164,
        });

        // Atualiza Apps
        await supabaseBrowser.from("client_apps").delete().eq("client_id", clientId);
        if (selectedApps.length > 0) {
            const toInsert = selectedApps.map(app => ({
                client_id: clientId, tenant_id: tid, app_id: app.app_id,
                field_values: { ...app.values, _config_cost: app.costType, _config_partner: app.partnerServerId }
            }));
            await supabaseBrowser.from("client_apps").insert(toInsert);
        }
        queueListToast(isTrialMode ? "trial" : "client", { type: "success", title: "Atualizado", message: "Cliente salvo com sucesso." });

      } else {
        // --- CRIAÇÃO ---
        const { data, error } = await supabaseBrowser.rpc("create_client_and_setup", {
  p_tenant_id: tid,
  p_created_by: createdBy,
  p_display_name: displayName,
  p_server_id: serverId,
  p_server_username: username,
  p_server_password: password?.trim() || "",
  p_screens: rpcScreens,
  p_plan_label: rpcPlanLabel,
  p_plan_table_id: selectedTableId || null, // ✅ CORREÇÃO: Envia NULL se estiver vazio
  p_price_amount: rpcPriceAmount,
  p_price_currency: rpcCurrency as any,
  p_vencimento: dueISO,
  p_phone_primary_e164: finalPrimaryE164,
  p_whatsapp_username: whatsappUsername || null,
  p_whatsapp_opt_in: Boolean(whatsappOptIn),
  p_whatsapp_snooze_until: snoozeISO,
  p_clear_whatsapp_snooze_until: clearSnooze, // ✅ NOVO
  p_notes: notes || null,
  p_app_ids: [],
  p_is_trial: isTrialMode,
  p_is_archived: false,
  p_technology: finalTechnology,
});


        if (error) {
          addToast("error", "Erro ao criar cliente", error.message);
          throw error;
        }

        clientId = data;

        if (clientId && namePrefix) {
          await supabaseBrowser.rpc("update_client", { p_tenant_id: tid, p_client_id: clientId, p_display_name: displayName, p_server_id: serverId, p_server_username: username, p_server_password: password?.trim() || "", p_screens: rpcScreens, p_plan_label: rpcPlanLabel, p_price_amount: rpcPriceAmount, p_price_currency: rpcCurrency as any, p_vencimento: dueISO, p_notes: notes || null, p_clear_notes: false, p_whatsapp_username: whatsappUsername || null, p_whatsapp_opt_in: Boolean(whatsappOptIn), p_whatsapp_snooze_until: snoozeISO, p_clear_whatsapp_snooze_until: clearSnooze, p_is_trial: isTrialMode, p_name_prefix: namePrefix });

        }

        if (finalExtrasE164.length > 0 && clientId) {
          await supabaseBrowser.rpc("set_client_phones", { p_tenant_id: tid, p_client_id: clientId, p_primary_e164: finalPrimaryE164, p_secondary_e164: finalExtrasE164 });
        }

        if (selectedApps.length > 0 && clientId) {
            const toInsert = selectedApps.map(app => ({
                client_id: clientId, tenant_id: tid, app_id: app.app_id,
                field_values: { ...app.values, _config_cost: app.costType, _config_partner: app.partnerServerId }
            }));
            await supabaseBrowser.from("client_apps").insert(toInsert);
        }
        queueListToast(isTrialMode ? "trial" : "client", { type: "success", title: isTrialMode ? "Teste criado" : "Cliente criado", message: "Cadastro realizado com sucesso." });
      }

      // RENOVAÇÃO AUTOMÁTICA (SE MARCADA)
      if (!isTrialMode && registerRenewal && clientId) {
        const monthsToRenew = Number(PLAN_MONTHS[selectedPlanPeriod] ?? 1);
        const { error: renewError } = await supabaseBrowser.rpc("renew_client_and_log", {
          p_tenant_id: tid,
          p_client_id: clientId,
          p_months: monthsToRenew,
          p_status: "PAID",
          p_notes: `Renovado no cadastro. Obs: ${notes || ""}`,
          p_new_vencimento: dueISO,
        });

        if (renewError) {
          addToast("error", "Falha ao registrar renovação", renewError.message);
        } else {
          queueListToast("client", { type: "success", title: "Cliente renovado", message: "Renovação registrada com sucesso." });
        }
      }

      setTimeout(() => { onSuccess(); onClose(); }, 900);

    } catch (err: unknown) {
      console.error("Erro RPC:", err);
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
      addToast("error", "Erro ao salvar", errorMsg);

    } finally {
      setLoading(false);
    }
  }

  // --- 2. FUNÇÃO QUE VALIDA E ABRE O POPUP ---
function handleSave() {
    // Validação reforçada
    if (!name.trim() || !username.trim() || !serverId || !primaryPhoneRaw.trim() || !whatsappUsername.trim()) {
      addToast("error", "Campos obrigatórios", "Preencha Nome, Usuário, Servidor, Telefone e WhatsApp.");
      return;
    }
    
    if (technology === "Personalizado" && !customTechnology.trim()) {
       addToast("error", "Tecnologia", "Para 'Personalizado', digite o nome da tecnologia.");
       return;
    }

    // Se estiver marcada a renovação, ABRE O MODAL
    if (registerRenewal && !isTrialMode) {
      const months = PLAN_MONTHS[selectedPlanPeriod] ?? 1;
      const rawPlanPrice = safeNumberFromMoneyBR(planPrice);
      
      const details = [
          `Cliente: ${name.trim()}`,
          `Plano: ${PLAN_LABELS[selectedPlanPeriod]} (${months} mês/meses)`,
          `Telas: ${screens}`,
          `Valor: ${fmtMoney(currency, rawPlanPrice)}`,
          `Novo vencimento: ${toBRDate(dueDate)} às ${dueTime}`
      ];

      setConfirmModal({
          open: true,
          title: "Confirmar Cadastro e Renovação",
          details
      });
      return;
    }

    // Se não tiver renovação, salva direto
    executeSave();
  }

  if (fetchingAux) return null;

  return (
    <>
      <ToastNotifications toasts={toasts} removeToast={removeToast} />

      <div
        className="fixed inset-0 z-[99990] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
        onClick={onClose}
      >
        <div
          className="w-full sm:max-w-3xl max-h-[90vh] sm:max-h-[90vh] bg-white dark:bg-[#161b22] border-t sm:border border-slate-200 dark:border-white/10 rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* HEADER */}
          <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-white dark:bg-[#161b22]">
            <h2 className="text-base font-bold text-slate-800 dark:text-white truncate">
              {isEditing ? (isTrialMode ? "Editar teste" : "Editar cliente") : (isTrialMode ? "Novo teste" : "Novo cliente")}
            </h2>
            <button
              onClick={onClose}
              type="button"
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 dark:text-white/40 transition-colors"
            >
              <IconX />
            </button>
          </div>

          {/* ABAS */}
          <div className="flex justify-center border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 px-4 py-2">
            <div className="flex bg-slate-200/50 dark:bg-black/20 rounded-lg p-1 w-full sm:w-auto overflow-x-auto">
              {([
                { key: "dados", label: "DADOS" },
                { key: "pagamento", label: isTrialMode ? "SERVIDOR" : "PAGAMENTO" },
                { key: "apps", label: "APLICATIVOS" },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 sm:flex-none px-6 py-2 text-xs font-bold rounded-md transition-all uppercase tracking-wider whitespace-nowrap ${
                    activeTab === tab.key
                      ? "bg-white dark:bg-white/10 text-emerald-600 dark:text-emerald-400 shadow-sm"
                      : "text-slate-500 dark:text-white/40 hover:text-slate-800 dark:hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* BODY */}
          <div className="p-3 sm:p-4 overflow-y-auto space-y-3 flex-1 bg-white dark:bg-[#161b22] custom-scrollbar">

            
            {/* TAB: DADOS */}
            {activeTab === "dados" && (
              <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                
                {/* Saudação + Nome */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <Label>Saudação</Label>
                    <Select value={salutation} onChange={(e) => setSalutation(e.target.value)}>
                      <option value="">(Nenhum)</option>
                      <option value="Sr.">Sr.</option>
                      <option value="Sra.">Sra.</option>
                      <option value="Dr.">Dr.</option>
                      <option value="Dra.">Dra.</option>
                      <option value="Dna.">Dna.</option>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Label>Nome do cliente *</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                  </div>
                </div>

                {/* Telefone + WhatsUser */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PhoneRow
                    label="Telefone principal"
                    countryLabel={primaryCountryLabel}
                    rawValue={primaryPhoneRaw}
                    onRawChange={setPrimaryPhoneRaw}
                    onDone={handleDonePrimary}
                  />

                  <div>
                    <Label>WhatsApp username</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">@</span>
                      <Input
                        className="pl-8 pr-10"
                        value={whatsappUsername}
                        onChange={(e) => {
                          setWhatsappUsername(e.target.value);
                          setWhatsUserTouched(true);
                        }}
                        placeholder="username"
                      />
                      {whatsappUsername && (
                        <a
                          href={`https://wa.me/${whatsappUsername}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 hover:text-emerald-600"
                          title="Abrir conversa"
                        >
                          <IconChat />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Telefones adicionais */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label> </Label>
                    <button
                      type="button"
                      onClick={() =>
                        setExtras((prev) => [
                          ...prev,
                          { id: Date.now() + Math.floor(Math.random() * 100000), raw: "", countryLabel: "—" },
                        ])
                      }
                      className="text-[10px] px-2 py-0.5 bg-emerald-500/10 rounded text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                    >
                      + ADD TELEFONE
                    </button>
                  </div>
                  <div className="space-y-2">
                    {extras.map((ex) => (
                      <PhoneRow
                        key={ex.id}
                        label="Telefone adicional"
                        countryLabel={ex.countryLabel}
                        rawValue={ex.raw}
                        onRawChange={(v) =>
                          setExtras((prev) => prev.map((x) => (x.id === ex.id ? { ...x, raw: v } : x)))
                        }
                        onDone={() => handleDoneExtra(ex.id)}
                        showRemove
                        onRemove={() => setExtras((prev) => prev.filter((x) => x.id !== ex.id))}
                      />
                    ))}
                  </div>
                </div>

                {/* Cadastro + Whats + Não Perturbe */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label>Data Cadastro</Label>
                    <Input
                      type="datetime-local"
                      value={createdAt}
                      onChange={(e) => setCreatedAt(e.target.value)}
                      className="h-10 text-xs"
                    />
                  </div>

                  <div className="pt-0 sm:pt-[18px]">
                    <div className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-600 dark:text-white/70 whitespace-nowrap">
                        Aceita msg?
                      </span>
                      <Switch
                        checked={whatsappOptIn}
                        onChange={setWhatsappOptIn}
                        label=""
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Não perturbe até</Label>
                    <Input
                      type="datetime-local"
                      value={dontMessageUntil}
                      onChange={(e) => setDontMessageUntil(e.target.value)}
                      className="h-10 text-xs"
                    />
                  </div>
                </div>

                {/* ✅ CAMPO DE OBSERVAÇÕES (Adicionado aqui conforme pedido) */}
                <div>
                   <Label>Observações Internas</Label>
                   <textarea
                     value={notes}
                     onChange={(e) => setNotes(e.target.value)}
                     placeholder="Anote detalhes importantes sobre este cliente..."
                     className="w-full h-20 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none transition-all"
                   />
                </div>

              </div>
            )}

            {/* TAB: PAGAMENTO */}
            {activeTab === "pagamento" && (
              <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                
                {/* CARD ACESSO */}
                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">
                   <div className="flex justify-between items-center gap-3">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Acesso</span>
                      
                      {/* Tecnologia */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 dark:text-white/40 font-bold hidden sm:inline">Tecnologia:</span>
                        {technology === "Personalizado" ? (
                            <div className="relative flex items-center">
                                 <input 
                                    value={customTechnology}
                                    onChange={(e) => setCustomTechnology(e.target.value)}
                                    className="h-8 w-[140px] sm:w-[180px] pl-2 pr-8 text-xs font-bold text-slate-700 dark:text-white bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded outline-none focus:border-emerald-500/50 transition-all"
                                    placeholder="Digite..."
                                    autoFocus
                                 />
                                 <button 
                                    type="button"
                                    onClick={() => { setTechnology("IPTV"); setCustomTechnology(""); }}
                                    className="absolute right-1 h-6 w-6 flex items-center justify-center rounded text-slate-400 hover:text-rose-500 transition-colors"
                                 >
                                    ✕
                                 </button>
                            </div>
                        ) : (
                            <select 
                                value={technology} 
                                onChange={(e) => {
                                     const val = e.target.value;
                                     if (val === "Personalizado") {
                                          setTechnology("Personalizado");
                                          setCustomTechnology(""); 
                                     } else {
                                          setTechnology(val);
                                     }
                                }} 
                                className="h-8 w-[100px] px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded text-xs font-bold text-slate-700 dark:text-white outline-none cursor-pointer hover:border-emerald-500/50 transition-all"
                            >
                                <option value="IPTV">IPTV</option>
                                <option value="P2P">P2P</option>
                                <option value="OTT">OTT</option>
                                {!["IPTV", "P2P", "OTT", "Personalizado"].includes(technology) && (
                                    <option value={technology}>{technology}</option>
                                )}
                                <option value="Personalizado">Outro...</option>
                            </select>
                        )}
                      </div>
                   </div>

                   {/* Inputs Acesso */}
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <Label>Servidor *</Label>
                        <Select value={serverId} onChange={(e) => setServerId(e.target.value)}>
                            <option value="">Selecione...</option>
                            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label>Usuário*</Label>
                        <Input value={username} onChange={(e) => setUsername(e.target.value)} />
                      </div>
                      <div>
                        <Label>Senha</Label>
                        <Input value={password} onChange={(e) => setPassword(e.target.value)} />
                      </div>
                   </div>
                </div>

                {!isTrialMode && (
                   <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">
                      <div className="flex justify-between items-center gap-3">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Plano</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 dark:text-white/40 font-bold hidden sm:inline">Tabela:</span>
                          <select 
                            value={selectedTableId} 
                            onChange={(e) => setSelectedTableId(e.target.value)} 
                            className="h-8 w-[120px] px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded text-xs font-bold text-slate-700 dark:text-white outline-none cursor-pointer hover:border-emerald-500/50 transition-all truncate"
                          >
                            {tables.map((t) => <option key={t.id} value={t.id}>{formatTableLabel(t)}</option>)}
                          </select>
                        </div>
                      </div>

                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div className="col-span-2 sm:col-span-1">
                          <Label>Plano</Label>
                          <Select
                            value={selectedPlanPeriod}
                            onChange={(e) => setSelectedPlanPeriod(e.target.value as any)}
                          >
                            {Object.entries(PLAN_LABELS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <Label>Telas</Label>
                          <Input
                            type="number"
                            min={1}
                            value={screens}
                            onChange={(e) => {
                              const val = e.target.value;
                              setScreens(val === "" ? ("" as any) : Math.max(1, Number(val)));
                            }}
                            onBlur={() => {
                              if (!screens || Number(screens) < 1) setScreens(1);
                            }}
                          />
                        </div>

                        <div className="col-span-2 sm:col-span-1">
                          <Label>Créditos</Label>
                          <div className="h-10 w-full bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-lg flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
                            {creditsInfo ? creditsInfo.used : "—"}
                          </div>
                        </div>
                      </div>


                      <div className="grid grid-cols-3 gap-3">
                        <div><Label>Moeda</Label><div className="h-10 w-full bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg flex items-center justify-center text-sm font-bold text-slate-700 dark:text-white">{currency}</div></div>
                        <div className="col-span-2"><Label>Valor</Label><Input value={planPrice} onChange={(e) => { setPlanPrice(e.target.value); setPriceTouched(true); }} placeholder="0,00" className="text-right font-bold tracking-tight text-lg" /></div>
                      </div>

                      {showFx && (
                        <div className="p-3 bg-sky-50 dark:bg-sky-500/10 rounded-lg border border-sky-100 dark:border-sky-500/20 grid grid-cols-2 gap-3">
                          <div><Label>Câmbio</Label><input type="number" step="0.0001" value={Number(fxRate || 0).toFixed(4)} onChange={(e) => setFxRate(Number(e.target.value))} className="w-full h-9 px-3 bg-white dark:bg-black/30 border border-sky-200 dark:border-sky-500/20 rounded text-sm outline-none dark:text-white" /></div>
                          <div><Label>Total BRL</Label><div className="w-full h-9 flex items-center justify-center bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/20 rounded text-emerald-800 dark:text-emerald-200 font-bold">{fmtMoney("BRL", totalBrl)}</div></div>
                        </div>
                      )}
                   </div>
                )}
                
                {/* VENCIMENTO */}
                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">
                   <div className="flex justify-between items-center"><span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vencimento</span></div>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><Label>Data</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="dark:[color-scheme:dark]" /></div>
                      <div>
                        <Label>Hora</Label>
                        <div className="flex gap-2">
                           <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="dark:[color-scheme:dark]" />
                           <button type="button" onClick={() => setDueTime("23:59")} className="px-2 rounded-lg bg-slate-200 dark:bg-white/10 text-[10px] font-bold text-slate-600 dark:text-white/70 hover:bg-slate-300 dark:hover:bg-white/20 border border-slate-300 dark:border-white/20 whitespace-nowrap" title="Fim do dia">23:59</button>
                        </div>
                      </div>
                   </div>
                   {!isEditing && (
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center justify-between gap-3"><span className="text-xs text-slate-600 dark:text-white/70">{isTrialMode ? "Teste automático" : "Registrar renovação"}</span><Switch checked={registerRenewal} onChange={(v) => { setRegisterRenewal(v); if (v) setSendPaymentMsg(true); else setSendPaymentMsg(false); }} label="" /></div>
                        <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center justify-between gap-3"><span className="text-xs text-slate-600 dark:text-white/70">{isTrialMode ? "Enviar msg teste" : "Enviar msg pagto"}</span><Switch checked={sendPaymentMsg} onChange={setSendPaymentMsg} label="" /></div>
                     </div>
                   )}
                </div>
              </div>
            )}

            {/* TAB: APLICATIVOS */}
            {activeTab === "apps" && (
              <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                
                {/* LISTA DE APPS JÁ ADICIONADOS */}
                <div className="space-y-3">
                  {selectedApps.map((app) => (
                    <div key={app.instanceId} className="p-4 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 relative group">
                      
                      {/* HEADER DO CARD (Sempre visível) */}
                      <div className="flex justify-between items-center">
                        <div 
                          className="flex items-center gap-2 cursor-pointer select-none"
                          onClick={() => setSelectedApps(prev => prev.map(a => a.instanceId === app.instanceId ? { ...a, is_minimized: !a.is_minimized } : a))}
                        >
                           <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                             📱 {app.name}
                           </span>
                           <span className="text-[10px] text-slate-400 font-medium transition-colors hover:text-slate-600 dark:hover:text-white/60">
                             {app.is_minimized ? "▼ Mostrar detalhes" : "▲ Ocultar detalhes"}
                           </span>
                        </div>

                        <button 
                          onClick={() => setSelectedApps(prev => prev.filter(a => a.instanceId !== app.instanceId))}
                          className="text-[10px] text-rose-500 font-bold hover:bg-rose-500/10 px-2 py-1 rounded transition-colors"
                        >
                          REMOVER
                        </button>
                      </div>

                      {/* CONTEÚDO EXPANSÍVEL (Minimizar/Maximizar) */}
                      {!app.is_minimized && (
                        <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
                          {/* Configuração de Custo e Parceria */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-100 dark:bg-white/5 p-3 rounded-lg border border-slate-200 dark:border-white/5 mb-3">
                              <div>
                                  <Label>Parceria com Servidor?</Label>
                                  <Select 
                                      value={app.partnerServerId} 
                                      onChange={(e) => updateAppConfig(app.instanceId, "partnerServerId", e.target.value)}
                                  >
                                      <option value="">Não (Nenhum)</option>
                                      {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                  </Select>
                              </div>
                              <div>
                                  <Label>Custo do Aplicativo</Label>
                                  <Select 
                                      value={app.costType} 
                                      onChange={(e) => updateAppConfig(app.instanceId, "costType", e.target.value)}
                                  >
                                      <option value="paid">Pago pelo Cliente</option>
                                      <option value="free">Gratuito / Incluso</option>
                                      {app.partnerServerId && <option value="partnership">Parceria (Pago pelo Server)</option>}
                                  </Select>
                              </div>
                          </div>

                          {/* Campos do App */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {app.fields_config?.length > 0 ? (
                              app.fields_config.map((field: any) => (
                                        <div key={field.id}>
                                          <Label>{field.label}</Label>
                                          <Input 
                                            type={field.type === 'date' ? 'date' : 'text'}
                                            value={app.values[field.label] || ""}
                                            onChange={(e) => updateAppFieldValue(app.instanceId, field.label, e.target.value)}
                                            placeholder={`Digite ${field.label}...`}
                                          />
                                        </div>
                                      ))
                                    ) : (
                                      <p className="text-[10px] text-slate-400 italic col-span-2 py-1">
                                        Este aplicativo não requer configuração adicional.
                                      </p>
                                    )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Seletor de Aplicativos (Tipo Combobox) */}
                <div className="relative mb-4">
                  {!showAppSelector ? (
                    <button 
                      onClick={() => { setShowAppSelector(true); setAppSearch(""); }} 
                      className="w-full h-14 border-2 border-dashed border-slate-300 dark:border-white/10 rounded-xl text-slate-500 dark:text-white/60 hover:text-emerald-600 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all font-bold text-sm uppercase flex items-center justify-center gap-2"
                    >
                      <span className="text-lg">+</span> Adicionar Aplicativo
                    </button>
                  ) : (
                    <div className="relative animate-in fade-in zoom-in-95 duration-200">
                      <div className="relative">
                        
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">🔍</div>
                        <input 
                          autoFocus
                          placeholder="Digite para buscar o aplicativo..."
                          value={appSearch}
                          onChange={(e) => setAppSearch(e.target.value)}
                          className="w-full h-10 pl-9 pr-10 bg-white dark:bg-[#0d1117] border border-emerald-500 ring-1 ring-emerald-500/20 rounded-lg text-sm text-slate-800 dark:text-white outline-none shadow-lg"
                        />
                        <button 
                          onClick={() => setShowAppSelector(false)} 
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded transition-colors"
                        >✕</button>
                      </div>

                                            <div className="mt-2 w-full bg-white dark:bg-[#1c2128] border border-slate-200 dark:border-white/10 rounded-xl shadow-xl min-h-[280px] max-h-[50vh] overflow-y-auto custom-scrollbar">
                        {(() => {
                          const filtered = catalog
                            .filter((app) => app.name.toLowerCase().includes(appSearch.toLowerCase()))
                            .sort((a, b) => a.name.localeCompare(b.name));

                          if (filtered.length === 0) {
                            return (
                              <div className="p-4 text-center text-xs text-slate-400 italic">
                                Nenhum aplicativo encontrado para &quot;{appSearch}&quot;.
                              </div>
                            );
                          }

                          return filtered.map((app) => (
                            <button
                              key={app.id}
                              onClick={() => addAppToClient(app)}
                              className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-white hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400 border-b border-slate-50 dark:border-white/5 last:border-0 transition-colors flex items-center justify-between group"
                            >
                              <span className="font-medium">{app.name}</span>
                              <span className="text-[10px] uppercase font-bold opacity-0 group-hover:opacity-100 transition-opacity text-emerald-600 dark:text-emerald-400">
                                Selecionar
                              </span>
                            </button>
                          ));
                        })()}
                      </div>

                    </div>
                  )}
                </div>

              </div>
            )}
          </div>

          {/* FOOTER */}
          <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-2">
            <button
              onClick={onClose}
              type="button"
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 text-xs font-bold transition-colors"
            >
              Cancelar
            </button>

            <button
              onClick={handleSave}
              disabled={loading}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg disabled:opacity-50 transition-all"
            >
              {loading ? "..." : isEditing ? "Salvar alterações" : (isTrialMode ? "Criar teste" : "Criar cliente")}
            </button>
          </div>
        </div>
      </div>

      {/* === MODAL DE CONFIRMAÇÃO (Padronizado) === */}
      {confirmModal && (
        <div className="fixed inset-0 z-[100000] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
            <div className="w-full sm:max-w-sm bg-white dark:bg-[#161b22] border-t sm:border border-slate-200 dark:border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 flex flex-col gap-5 animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                
                <div className="flex flex-col items-center text-center gap-3">
                    <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-3xl">
                        💰
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">{confirmModal.title}</h3>
                        <p className="text-sm text-slate-500 dark:text-white/60 mt-1">Confira os dados financeiros.</p>
                    </div>
                </div>
                
                <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4 border border-slate-100 dark:border-white/5">
                    <ul className="space-y-2.5">
                        {confirmModal.details.map((line, i) => (
                            <li key={i} className="text-sm text-slate-700 dark:text-slate-300 flex items-start gap-2.5">
                                <span className="text-emerald-500 font-bold mt-0.5">•</span>
                                <span className="leading-tight">{line}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="flex gap-3 pt-2">
                    <button 
                        onClick={() => setConfirmModal(null)}
                        className="flex-1 h-12 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 font-bold text-sm hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                    >
                        Voltar
                    </button>
                    <button 
                        onClick={executeSave}
                        className="flex-1 h-12 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-500 shadow-lg shadow-emerald-500/30 transition-all transform active:scale-95"
                    >
                        Confirmar
                    </button>
                </div>
            </div>
        </div>
      )}
    </>
  );
}
function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}