"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "../ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm"; // ✅ Trazendo a caixa de confirmação bonita

// --- TIPOS ---
type SelectOption = {
  id: string;
  name: string;
};

export type ClientData = {
  id?: string;
  created_at?: string; 
  client_name: string;
  name_prefix?: string | null; // ✅ ADICIONADO AQUI PARA O TYPESCRIPT PARAR DE RECLAMAR
  username: string;
  server_password?: string;
  whatsapp_e164?: string;
  whatsapp_username?: string;
  whatsapp_opt_in?: boolean;
  secondary_display_name?: string | null;
  secondary_name_prefix?: string | null;
  secondary_phone_e164?: string | null;
  secondary_whatsapp_username?: string | null;
  dont_message_until?: string;
  server_id: string;
  screens: number;
  notes?: string;
  plan_name?: string;
  price_amount?: number;
  price_currency?: string;
  plan_table_id?: string | null;
  plan_table_name?: string | null;
  external_user_id?: string | null;
  vencimento?: string; // timestamptz
  apps_names?: string[];
  technology?: string;
  m3u_url?: string; // ✅ ADICIONADO
};

type ModalMode = "client" | "trial";

interface Props {
  clientToEdit?: ClientData | null;
  sourceClientId?: string;
  defaultSendWhatsapp?: boolean; // ✅ Teste rápido começa com WhatsApp desligado
  mode?: ModalMode;
  initialTab?: "dados" | "pagamento" | "apps";
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
  table_type?: string | null;
  items: PlanTableItem[];
}

interface MessageTemplate {
   id: string;
   name: string;
   content: string;
   image_url?: string | null; 
   category?: string | null; // ✅ Busca a Categoria
 }

const APP_FIELD_LABELS: Record<string, string> = {
  date: "Vencimento",
  mac: "Device ID (MAC)",
  device_key: "Device Key",
  email: "E-mail",
  password: "Senha",
  url: "URL",
  obs: "Obs",
};

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

// --- HELPERS WHATSAPP ---
function extractWaNumberFromJid(jid?: unknown): string {
  if (typeof jid !== "string") return "";
  const raw = jid.split("@")[0]?.split(":")[0] ?? "";
  return raw.replace(/\D/g, "");
}

function formatBRPhoneFromDigits(digits: string): string {
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) {
    const country = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) return `+${country} (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+${country} (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `+${country} (${ddd}) ${rest}`;
  }
  return `+${digits}`;
}

function buildWhatsAppSessionLabel(profile: any, sessionName: string): string {
  if (!profile?.connected) return `${sessionName} (não conectado)`;
  const digits = extractWaNumberFromJid(profile?.jid);
  const pretty = formatBRPhoneFromDigits(digits);
  return `${sessionName} • ${pretty || "Conectado"}`;
}

// --- HELPERS ---
function onlyDigits(raw: string) {
  return raw.replace(/\D+/g, "");
}

function normalizeMacInput(raw: string) {
  // ✅ MAC: mantém só HEX, UPPER e formata XX:XX:XX:XX:XX:XX
  const s = String(raw ?? "").toUpperCase();
  // mantém somente 0-9 e A-F (remove :, -, espaços, etc)
  const hex = s.replace(/[^0-9A-F]/g, "");
  // MAC padrão = 12 hex (6 bytes)
  const trimmed = hex.slice(0, 12);
  // quebra em pares (mantém par incompleto enquanto digita)
  const pairs = trimmed.match(/.{1,2}/g) || [];

  return pairs.join(":");
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

  if (!Number.isFinite(ms)) return "";
  // ✅ ignora epoch / sentinela (qualquer coisa antes de 2001, por segurança)
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
{ code: "353", label: "Irlanda", flag: "🇮🇪" }, // ✅ ADICIONADO

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


function inferDDIFromDigits(allDigits: string, originalInput?: string): string {
  const digits = onlyDigits(allDigits || "");
  if (!digits) return "55";
  
  // Tenta encontrar nos conhecidos primeiro
  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) {
    if (digits.startsWith(opt.code)) return opt.code;
  }

  // Se o usuário digitou "+" explicitamente, não força "55". Tenta extrair.
  if (originalInput && originalInput.trim().startsWith("+")) {
      // DDI tem no máximo 3 ou 4 dígitos, pega o que fizer sentido
      const possibleDDI = digits.slice(0, 3); 
      return possibleDDI; 
  }

  // Se não tem + e não está na lista, assume Brasil
  return "55";
}

function ddiMeta(ddi: string) {
  const opt = DDI_OPTIONS.find((o) => o.code === ddi);

  if (!opt) return { label: `DDI Desconhecido (+${ddi})`, pretty: `🌍 DDI (+${ddi})` }; // ✅ Mais amigável
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


// ✅ Extrai o DDI numérico do label do país (ex: "Irlanda (+353)" → "353")
function extractDdiFromLabel(label: string): string {
  const match = label.match(/\+(\d+)\)/);
  return match ? match[1] : "55";
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

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
};

function Input({ className = "", ...props }: InputProps) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors dark:[color-scheme:dark] ${className}`}
    />
  );
}

function FormattedDateInput({ type, value, onChange, className = "", ...props }: any) {
  const [isFocused, setIsFocused] = useState(false);

  if (type !== "date" && type !== "datetime-local") {
    return <Input type={type} value={value} onChange={onChange} className={className} {...props} />;
  }

  let displayValue = value;
  if (!isFocused && value) {
    try {
      if (type === "date") {
        const [y, m, d] = value.split("-");
        if (y && m && d) displayValue = `${d}/${m}/${y}`;
      } else if (type === "datetime-local") {
        const [datePart, timePart] = value.split("T");
        if (datePart && timePart) {
          const [y, m, d] = datePart.split("-");
          if (y && m && d) displayValue = `${d}/${m}/${y} ${timePart}`;
        }
      }
    } catch (e) {}
  }

  return (
    <Input
      type={isFocused ? type : "text"}
      value={isFocused ? value : displayValue}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onChange={onChange}
      className={className}
      {...props}
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
  disabled = false, // ✅ NOVO
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean; // ✅ NOVO
}) {

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-700 dark:text-white/70">{label}</span>
      <button
        type="button"
        onClick={() => !disabled && onChange(!checked)} // ✅ NOVO
        disabled={disabled} // ✅ NOVO
        className={`relative w-12 h-7 rounded-full transition-colors border ${
          checked
            ? "bg-emerald-600 border-emerald-600"
            : "bg-slate-200 dark:bg-white/10 border-slate-300 dark:border-white/10"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`} // ✅ NOVO
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

export default function NovoCliente({ clientToEdit, sourceClientId, defaultSendWhatsapp, mode = "client", initialTab, onClose, onSuccess }: Props) {
  // ✅ Scroll lock padrão (não deixa “vazar” e restaura posição)
const modalScrollYRef = useRef(0);

useEffect(() => {
  if (typeof window === "undefined") return;
  const body = document.body;
  const html = document.documentElement;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  modalScrollYRef.current = scrollY;
  const prevBodyOverflow = body.style.overflow;
  const prevBodyPosition = body.style.position;
  const prevBodyTop = body.style.top;
  const prevBodyWidth = body.style.width;
  const prevHtmlOverflow = html.style.overflow;
  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.width = "100%";

  return () => {
    html.style.overflow = prevHtmlOverflow;
    body.style.overflow = prevBodyOverflow;
    body.style.position = prevBodyPosition;
    body.style.top = prevBodyTop;
    body.style.width = prevBodyWidth;
    window.scrollTo(0, modalScrollYRef.current || 0);
  };
}, []);
  const isEditing = !!(clientToEdit?.id); // ✅ sem id = criação (ex: Teste Rápido)
  const isTrialMode = mode === "trial";
  const [activeTab, setActiveTab] = useState<"dados" | "pagamento" | "apps">(initialTab || "dados");

    useEffect(() => {
    if (!initialTab) return;
    setActiveTab(initialTab);
  }, [initialTab]);

  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(""); // ✅ NOVO: Guarda o texto do passo atual
  const [fetchingAux, setFetchingAux] = useState(true);

  // --- TOAST STATE ---
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const TOAST_DURATION = 5000;
  const toastSeq = useRef(1);

    // ✅ trava para não resetar override durante o prefill inicial
  const didInitRef = useRef(false);
  const addToast = (type: "success" | "error" | "warning", title: string, message?: string) => {
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

  // NOVO: Contato Secundário
  const [showSecondary, setShowSecondary] = useState(false);
  const [secondarySalutation, setSecondarySalutation] = useState<string>("");
  const [secondaryName, setSecondaryName] = useState("");
  const [secondaryPhoneRaw, setSecondaryPhoneRaw] = useState("");
  const [secondaryCountryLabel, setSecondaryCountryLabel] = useState<string>(ddiMeta("55").label);
  const [secondaryWhatsappUsername, setSecondaryWhatsappUsername] = useState("");
  const [secondaryWhatsUserTouched, setSecondaryWhatsUserTouched] = useState(false);

type WaValidation = { loading: boolean; exists: boolean; jid?: string } | null;
const [waValidation, setWaValidation] = useState<WaValidation>(null);
const [secondaryWaValidation, setSecondaryWaValidation] = useState<WaValidation>(null);
const waValidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const secondaryValidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

async function validateWa(username: string, setter: (v: WaValidation) => void, countryLabelSetter?: (v: string) => void) {
  const digits = username.replace(/\D/g, "");
  if (digits.length < 8) { setter(null); return; }
  setter({ loading: true, exists: false });
  try {
    const res = await fetch("/api/whatsapp/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: digits }),
    });
    const json = await res.json().catch(() => ({}));
    setter({ loading: false, exists: !!json.exists, jid: json.jid });

    // Resolve país pelo JID do WhatsApp se disponível
    if (json.exists && json.jid && countryLabelSetter) {
      const jidDigits = String(json.jid).split("@")[0].split(":")[0].replace(/\D/g, "");
      if (jidDigits) {
        const ddi = inferDDIFromDigits(jidDigits);
        countryLabelSetter(ddiMeta(ddi).label);
      }
    }
  } catch {
    setter({ loading: false, exists: false });
  }
}
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


// ✅ Cliente: ON por padrão na CRIAÇÃO
// ✅ EDIÇÃO: NUNCA renova (fica false e o toggle nem aparece)

const [registerRenewal, setRegisterRenewal] = useState(() => (!isTrialMode && !isEditing));
const [sendPaymentMsg, setSendPaymentMsg] = useState(!isTrialMode); // ✅ Cliente: ON por padrão

// ✅ TRIAL: envio de mensagem de teste (padrão LIGADO)
const [sendTrialWhats, setSendTrialWhats] = useState(defaultSendWhatsapp ?? true);

// ✅ NOVO: Controle de horas de teste e M3U
const [testHours, setTestHours] = useState<2 | 4 | 6>(2);

// ✅ NOVO: Provider do painel (pra travar horas por servidor)
const [trialProvider, setTrialProvider] = useState<
  "NONE" | "FAST" | "NATV" | "ELITE" | "OTHER"
>("NONE");
const [trialHoursLocked, setTrialHoursLocked] = useState(false);

const [m3uUrl, setM3uUrl] = useState("");

// ✅ NOVO: external_user_id (ID do usuário no painel)
const [externalUserId, setExternalUserId] = useState<string>("");
const [serverDomains, setServerDomains] = useState<string[]>([]); // ✅ NOVO

// ✅ Templates WhatsApp
const [templates, setTemplates] = useState<MessageTemplate[]>([]);
const [selectedTemplateId, setSelectedTemplateId] = useState("");
const [messageContent, setMessageContent] = useState("");

// ✅ NOVO: Controle de Sessão
const [selectedSession, setSelectedSession] = useState("default");
const [sessionOptions, setSessionOptions] = useState<{id: string, label: string}[]>([
  { id: "default", label: "Carregando..." }
]);

async function loadWhatsAppSessions() {
  try {
    const [res1, res2] = await Promise.all([
      fetch("/api/whatsapp/profile", { cache: "no-store" }).catch(() => null),
      fetch("/api/whatsapp/profile2", { cache: "no-store" }).catch(() => null)
    ]);

    const prof1 = res1 && res1.ok ? await res1.json().catch(()=>({})) : {};
    const prof2 = res2 && res2.ok ? await res2.json().catch(()=>({})) : {};

    const name1 = typeof window !== "undefined" ? localStorage.getItem("wa_label_1") || "Contato Principal" : "Contato Principal";
    const name2 = typeof window !== "undefined" ? localStorage.getItem("wa_label_2") || "Contato Secundário" : "Contato Secundário";

    setSessionOptions([
      { id: "default", label: buildWhatsAppSessionLabel(prof1, name1) },
      { id: "session2", label: buildWhatsAppSessionLabel(prof2, name2) }
    ]);
  } catch (e) {}
}

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
  
  // ✅ Instanciando o hook para a remoção do App
  const { confirm: confirmDeleteApp, ConfirmUI } = useConfirm();

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
  auto_configure?: boolean; // ✅ Automação na criação
};

// --- ESTADOS ---
  const [catalog, setCatalog] = useState<AppCatalog[]>([]);
  const [selectedApps, setSelectedApps] = useState<SelectedAppInstance[]>([]);
  const [showAppSelector, setShowAppSelector] = useState(false);
  const [appSearch, setAppSearch] = useState(""); // ✅ NOVO: Controle da busca
  const [notes, setNotes] = useState("");
  const [visibleAppPasswords, setVisibleAppPasswords] = useState<Record<string, boolean>>({}); // ✅ NOVO: Controle de visibilidade de senha por campo

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

    const ddi = inferDDIFromDigits(rawDigits, rawInput); // ✅ Passa a string inteira
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

  const finalUser = whatsUserTouched ? whatsappUsername : onlyDigits(norm.e164);
  if (!whatsUserTouched) setWhatsappUsername(finalUser);

  void validateWa(finalUser, setWaValidation, setPrimaryCountryLabel);
}

function handleDoneSecondary() {
  const norm = applyPhoneNormalization(secondaryPhoneRaw);
  setSecondaryCountryLabel(norm.countryLabel);
  setSecondaryPhoneRaw(norm.formattedNational || norm.nationalDigits || secondaryPhoneRaw);

  const finalUser = secondaryWhatsUserTouched ? secondaryWhatsappUsername : onlyDigits(norm.e164);
  if (!secondaryWhatsUserTouched) setSecondaryWhatsappUsername(finalUser);

  void validateWa(finalUser, setSecondaryWaValidation, setSecondaryCountryLabel);
}

// ✅ NOVO: Detectar provider + integração (FAST=4h fixo, NATV=6h padrão editável, ELITE=2h fixo)
const [hasIntegration, setHasIntegration] = useState(false);
const [syncWithServer, setSyncWithServer] = useState(false); // ✅ NOVO: Controla se chama a API ou não

useEffect(() => {
  if (!serverId) {
    setHasIntegration(false);
    setSyncWithServer(false);
    setTrialProvider("NONE");
    setTrialHoursLocked(false);
    if (isTrialMode) setTestHours(2);
    if (!isTrialMode) setRegisterRenewal(false);
    return;
  }

  let mounted = true;
  (async () => {
    try {
      const { data: srv, error: srvErr } = await supabaseBrowser
        .from("servers")
        .select("panel_integration")
        .eq("id", serverId)
        .single();

      if (!mounted) return;
      if (srvErr) throw srvErr;
      const integrationId = String(srv?.panel_integration || "");
      const hasInteg = Boolean(integrationId);
      setHasIntegration(hasInteg);

      // ✅ SE FOR CRIAÇÃO DE CLIENTE, FORÇA OFFLINE (syncWithServer = false)
      // SE FOR TESTE OU EDIÇÃO, MANTÉM A LÓGICA ORIGINAL
      if (!isEditing && !isTrialMode) {
          setSyncWithServer(false);
      } else {
          setSyncWithServer(hasInteg);
      }

      if (isTrialMode) {
        setRegisterRenewal(false);

      } else {
        setRegisterRenewal(hasInteg);
      }

      if (!hasInteg) {
        setTrialProvider("NONE");
        setTrialHoursLocked(false);
        if (isTrialMode) setTestHours(2);
        return;
      }

      const { data: integ, error: integErr } = await supabaseBrowser
        .from("server_integrations")
        .select("provider")
        .eq("id", integrationId)
        .single();

      if (!mounted) return;
      if (integErr) throw integErr;
      const provider = String(integ?.provider || "").toUpperCase();

      if (provider === "FAST") {
        setTrialProvider("FAST");
        setTrialHoursLocked(true);
        if (isTrialMode) setTestHours(4);
        return;
      }

      if (provider === "NATV") {
        setTrialProvider("NATV");
        setTrialHoursLocked(false);
        if (isTrialMode) setTestHours(6);
        return;
      }

      if (provider === "ELITE") {
        setTrialProvider("ELITE");
        setTrialHoursLocked(true);
        if (isTrialMode) setTestHours(2);
        return;
      }

      setTrialProvider("OTHER");
      setTrialHoursLocked(false);
      if (isTrialMode) setTestHours(2);

    } catch (e) {
      console.error("Erro ao detectar provider/integração:", e);
      if (!mounted) return;
      setHasIntegration(false);
      setSyncWithServer(false);
      setTrialProvider("NONE");
      setTrialHoursLocked(false);
 
      if (isTrialMode) setTestHours(2);
      if (!isTrialMode) setRegisterRenewal(false);
    }
  })();

  return () => {
    mounted = false;
  };
}, [isTrialMode, serverId]);


  // ======= LOAD AUX + EDIT PREFILL =======
// ✅ NOVO: Atualizar vencimento quando mudar período de teste
useEffect(() => {
  if (!isTrialMode) return;
  if (isEditing) return; // ✅ TRAVA: Evita recalcular a hora ao abrir um teste existente
  const now = new Date();
  const target = new Date(now.getTime() + testHours * 60 * 60 * 1000); // +X horas
  const dISO = `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`;
  const tISO = `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;

  setDueDate(dISO);
  setDueTime(tISO);
}, [testHours, isTrialMode, serverId]); // ✅ inclui serverId pra recalcular ao trocar servidor

// ✅ NOVO: Buscar DNSs do servidor selecionado (coluna dns = JSON array)

useEffect(() => {
  if (!serverId) {
    setServerDomains([]);
    return;
  }

  (async () => {
    try {
      const { data: srv } = await supabaseBrowser
        .from("servers")
        .select("dns")
        .eq("id", serverId)
        .single();
      if (!srv || !srv.dns) {
        setServerDomains([]);
        return;
      }

      // dns é um array JSON
      const domains = Array.isArray(srv.dns) 
        ? srv.dns.filter((d: any) => d && String(d).trim().length > 0)
        : [];
      setServerDomains(domains);

    } catch (e) {
      console.error("Erro ao buscar domínios:", e);
      setServerDomains([]);
    }
  })();
}, [serverId]);

useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const tid = await getCurrentTenantId();

        if (tid) {
          await loadWhatsAppSessions(); // ✅ Carrega as sessões para o Select
        }

        // 1. Servidores
        const srvRes = await supabaseBrowser
          .from("servers")
          .select("id, name")
          .eq("tenant_id", tid)
          .eq("is_archived", false);

        // 2. Apps (Catálogo Completo com Configuração)
        // ✅ Usa a RPC segura para carregar os Locais + Globais visíveis!
        const { data: appsDataRaw, error: appsErr } = await supabaseBrowser
          .rpc("get_my_visible_apps");
          
        if (appsErr) {
          console.warn("Erro ao carregar catálogo de apps:", appsErr.message);
        }
        
        // Filtra apenas os ativos para exibir no dropdown (caso a RPC traga inativos também)
        const appsData = (appsDataRaw || []).filter((a: any) => a.is_active === true);

        // 3. Tabelas de Preço
        const tRes = await supabaseBrowser
          .from("plan_tables")
          .select(
            `id, name, currency, is_system_default, table_type,
             items:plan_table_items (id, period, credits_base, prices:plan_table_item_prices (screens_count, price_amount))`
          )
          .eq("tenant_id", tid)
          .eq("is_active", true)
          .eq("table_type", "iptv");
        if (!alive) return;

// ✅ 4) Templates (para mensagem automática / teste)
  const { data: tmplData, error: tmplErr } = await supabaseBrowser
  .from("message_templates")
  .select("id, name, content, image_url, category") // ✅ AGORA TRAZ A CATEGORIA
  .eq("tenant_id", tid)
  .order("name", { ascending: true });
if (!alive) return;

if (tmplErr) {
  console.warn("Erro ao carregar templates:", tmplErr.message);
} else {
  // Fallback automático caso a categoria ainda não tenha sido salva no banco
  const list = ((tmplData as any[]) || []).map((r) => {
    let cat = r.category || "Geral";
    if (!r.category || r.category === "Geral") {
      if (r.name === "Pagamento Realizado" || r.name === "Teste - Boas-vindas") cat = "Cliente IPTV";
      else if (r.name === "Recarga Revenda") cat = "Revenda IPTV";
      else if (String(r.name).toUpperCase().includes("SAAS")) cat = "Revenda SaaS";
    }
    return { ...r, category: cat };
  }) as MessageTemplate[];
  
  setTemplates(list);

  // ✅ TRIAL: por padrão liga envio e seleciona template "Teste..."
if (isTrialMode) {
  setSendTrialWhats(defaultSendWhatsapp ?? true); // ✅ respeita a prop
  const defaultTpl =
    list.find((t) => (t.name || "").trim().toLowerCase().startsWith("teste")) ||
    list.find((t) => (t.name || "").toLowerCase().includes("teste")) ||
    null;

  if (defaultTpl) {
    setSelectedTemplateId(defaultTpl.id);
    setMessageContent(defaultTpl.content || "");
  } else {
    setSelectedTemplateId("");
    setMessageContent("");
  }
}


// ✅ CLIENTE: por padrão liga envio e seleciona template "Pagamento"

if (!isTrialMode) {
  setSendPaymentMsg(true);
  const defaultTpl =
    list.find((t) => (t.name || "").trim().toLowerCase().includes("pagamento")) ||
    list.find((t) => (t.name || "").toLowerCase().includes("pago")) ||
    null;

  if (defaultTpl) {
    setSelectedTemplateId(defaultTpl.id);
    setMessageContent(defaultTpl.content || "");
  } else {
    setSelectedTemplateId("");
    setMessageContent("");
  }
}
}

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

if (isTrialMode && defaultBRL && !clientToEdit?.price_amount) {
  setSelectedTableId(defaultBRL.id);
  setCurrency("BRL");
  setSelectedPlanPeriod("MONTHLY");
  setScreens(1);
  const p = pickPriceFromTable(defaultBRL, "MONTHLY", 1);
  setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
  setPriceTouched(false);

  // ✅ NOVO: Definir horas padrão (será ajustado quando selecionar servidor)
  setTestHours(2);
}

// ===== PREFILL EDIÇÃO =====
if (clientToEdit) {
  setName((clientToEdit.client_name || "").trim());
  setSalutation(clientToEdit.name_prefix || ""); // ⬅️ ISSO AQUI É OBRIGATÓRIO PARA A SAUDAÇÃO APARECER!
  
  // ✅ POPULAR DATA DE CADASTRO DO BANCO
  if (clientToEdit.created_at) {
    setCreatedAt(isoToLocalDateTimeInputValue(clientToEdit.created_at));
  }

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

  // ✅ M3U URL
  setM3uUrl(clientToEdit.m3u_url || "");

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

  setSecondaryName(clientToEdit.secondary_display_name || "");
  setSecondarySalutation(clientToEdit.secondary_name_prefix || "");

  if (clientToEdit.secondary_display_name || clientToEdit.secondary_phone_e164 || clientToEdit.secondary_whatsapp_username) {
    setShowSecondary(true);
  }

  if (clientToEdit.secondary_phone_e164) {
    const { ddi, national } = splitE164(clientToEdit.secondary_phone_e164);
    setSecondaryCountryLabel(ddiMeta(ddi).label);
    setSecondaryPhoneRaw(formatNational(ddi, national) || national);
    if (!secondaryWhatsUserTouched) {
      setSecondaryWhatsappUsername(
        clientToEdit.secondary_whatsapp_username || onlyDigits(clientToEdit.secondary_phone_e164)
      );
    }
  } else if (clientToEdit.secondary_whatsapp_username) {
    setSecondaryWhatsappUsername(clientToEdit.secondary_whatsapp_username);
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
  .select("notes, external_user_id, created_at") // ✅ ADICIONADO created_at
  .eq("tenant_id", tid)
  .eq("id", clientToEdit.id)
  .maybeSingle();

if (!nerr) {
  setNotes((nrow?.notes || "").toString());
  setExternalUserId(String(nrow?.external_user_id || "").trim());
  
  // ✅ SE ACHOU A DATA NO BANCO, ATUALIZA A TELA AQUI:
  if (nrow?.created_at) {
    setCreatedAt(isoToLocalDateTimeInputValue(nrow.created_at));
  }
} else {
  setNotes(clientToEdit.notes || "");
  setExternalUserId(String((clientToEdit as any)?.external_user_id || "").trim());
}
    } else {
      setNotes(clientToEdit.notes || "");
    }
  } catch {
    setNotes(clientToEdit.notes || "");
  }


  // ✅ CARREGAMENTO DE APPS (NOVA LÓGICA)

  const appsSourceId = clientToEdit?.id || sourceClientId || null;
if (appsSourceId) {
  const { data: currentApps } = await supabaseBrowser
    .from("client_apps")
    .select("app_id, field_values, apps(name, fields_config)")
    .eq("client_id", appsSourceId);



    if (currentApps) {

      const instances = currentApps.map((ca: any) => {

  const savedValues = ca.field_values || {};

  const { _config_cost, _config_partner, ...restValues } = savedValues;



  const cfg = Array.isArray(ca.apps?.fields_config) ? ca.apps.fields_config : [];



  // ✅ Normaliza: no state fica sempre por field.id (fallback por label)

  const normalizedValues: Record<string, string> = {};

  for (const f of cfg) {

    const idKey = String(f?.id ?? "").trim();

    const labelKey = String(f?.label ?? "").trim();



    const v =

      (idKey && restValues[idKey] != null) ? restValues[idKey] :

      (labelKey && restValues[labelKey] != null) ? restValues[labelKey] :

      "";



    const finalKey = idKey || labelKey;

    if (finalKey) {

const isMac =

  String(f?.type || "").toUpperCase() === "MAC" ||

  /\bmac\b/i.test(labelKey) ||

  /\bmac\b/i.test(idKey);



normalizedValues[finalKey] = isMac

  ? normalizeMacInput(String(v ?? ""))

  : String(v ?? "");

}

  }



  return {

    instanceId: crypto.randomUUID(),

    app_id: ca.app_id,

    name: ca.apps?.name || "App Removido",

    values: normalizedValues,

    fields_config: cfg,

    costType: _config_cost || "paid",

    partnerServerId: _config_partner || "",

    is_minimized: true,

  };

});

setSelectedApps(instances);

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



// ✅ TRAVA DE TECNOLOGIA POR PROVEDOR

  useEffect(() => {
    if (isEditing) return; // ✅ Não sobrescreve tecnologia salva ao editar
    if (trialProvider === "FAST" || trialProvider === "NATV") {
      if (technology !== "IPTV") {
        setTechnology("IPTV");
        setCustomTechnology("");
      }
    } else if (trialProvider === "ELITE") {
      if (technology !== "IPTV" && technology !== "P2P") {
        setTechnology("IPTV");
        setCustomTechnology("");
        addToast("warning", "Tecnologia ajustada", "O Elite só aceita IPTV ou P2P.");
      }
    }
  }, [trialProvider, technology]);



  // ✅ TRAVA DO PLANO ANUAL PARA ELITE

  useEffect(() => {

    if (trialProvider === "ELITE" && selectedPlanPeriod === "ANNUAL") {

      setSelectedPlanPeriod("SEMIANNUAL");

      addToast("warning", "Limite", "A Elite permite recargas de no máximo 6 meses.");

    }

  }, [trialProvider, selectedPlanPeriod]);



  // 1) Se mudar a estrutura...

  useEffect(() => {
    if (!didInitRef.current) return;
    if (isEditing) return;
    if (isTrialMode && clientToEdit?.price_amount) return; // ✅ protege teste rápido
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

      fields_config: Array.isArray(app.fields_config) ? app.fields_config : [], 

      values: {},

      costType: "paid", 
      partnerServerId: "",
      is_minimized: false, // ✅ AGORA O APP NOVO JÁ NASCE ABERTO PRA DIGITAR O MAC
      auto_configure: true // ✅ Nasce com a integração marcada para sim
    };

    setSelectedApps(prev => [...prev, newInstance]);

    setShowAppSelector(false);

  }



  // ✅ Nova função para atualizar Custo/Parceria
  function updateAppConfig(instanceId: string, key: "costType" | "partnerServerId" | "auto_configure", value: any) {

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



function updateAppFieldValue(instanceId: string, fieldKey: string, value: string) {
  setSelectedApps(prev => prev.map(app => {
    if (app.instanceId !== instanceId) return app;
    return { ...app, values: { ...app.values, [fieldKey]: value } };
  }));
}

  // ✅ FUNÇÃO QUE COMUNICA COM A EXTENSÃO DO CHROME (BYPASS CLOUDFLARE)
  async function handleConfigApp(appName: string) {
    if (!clientToEdit?.id) {
      addToast("warning", "Atenção", "Salve o cliente primeiro antes de configurar o aplicativo.");
      return;
    }

    setLoading(true);
    setLoadingStep("A enviar para a Extensão...");

    // 1. Calcular o nome do servidor (Ex: Insqueixa_NaTV)
    const selectedServerName = servers.find((s) => s.id === serverId)?.name || "Servidor";
    const shortServerName = selectedServerName.replace(/\s+/g, "");
    const finalServerName = `${username}_${shortServerName}`;

    // 1.5 Calcula a data exata de 1 ano para frente a partir de hoje
    const today = new Date();
    today.setFullYear(today.getFullYear() + 1);
    const expireDate1Year = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 1.6 Busca o MAC de forma CORRETA (Lendo o ID do campo ao invés de adivinhar a chave)
    const currentApp = selectedApps.find(a => a.name === appName);
    let macValue = "";

    if (currentApp) {
        const macField = currentApp.fields_config?.find((f: any) => String(f?.type || "").toUpperCase() === "MAC");
        if (macField) {
            const key = String(macField.id || macField.label || "").trim();
            macValue = currentApp.values[key] || "";
        }
        // Fallback garantido: procura por qualquer valor salvo que tenha o formato de MAC (com ":")
        if (!macValue) {
            const foundKey = Object.keys(currentApp.values).find(k => String(currentApp.values[k]).includes(":"));
            if (foundKey) macValue = currentApp.values[foundKey];
        }
    }

    if (!macValue || macValue.trim() === "") {
        addToast("error", "MAC Obrigatório", "Preencha o Device ID (MAC) na aba 'Aplicativos' antes de configurar.");
        setLoading(false);
        setLoadingStep("");
        return;
    }

    // 2. Payload blindado com as SUAS regras estritas (Sem enviar variáveis falsas)
    const payload = {
        modo_selecao: 1,
        mac_device: macValue,
        server_name: finalServerName,
        account_username: "",
        account_password: "",
        xteam_username: "",
        xteam_password: "",
        username_login: username,
        password_login: password || "",
        ranking_app_id: 10,
        dns: "",
        m3u8_list: m3uUrl || "",
        url_epg: "",
        price: 0,
        plan_id: "",
        expire_date: expireDate1Year,
        dnsOptions: "",
        whatsapp: "",
        is_trial: 0, 
        
    };

    // 3. Prepara o receptor da resposta da extensão
    const responseHandler = (e: any) => {
        window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
        setLoading(false);
        setLoadingStep("");

        const result = e.detail;
        if (result && result.ok) {
            addToast("success", "Integrado!", `Aplicativo configurado com sucesso!`);
        } else {
            addToast("error", "Erro na Integração", result?.error || "Falha desconhecida.");
        }
    };

    window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);

    // 4. Dispara a ordem para a Extensão do Chrome fazer o trabalho sujo
    window.dispatchEvent(new CustomEvent("UNIGESTOR_INTEGRATION_CALL", {
        detail: {
            action: "GERENCIAAPP_CREATE",
            payload: payload
        }
    }));
    
    // 5. Timeout de segurança (Aumentado para 20 segundos)
    setTimeout(() => {
        setLoading((prevLoading) => {
            if (prevLoading) { // Se ainda estiver carregando após 20s, avisa o usuário
                window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
                addToast("warning", "Aviso", "O comando foi enviado, mas a resposta demorou. Verifique o painel.");
                setLoadingStep("");
                return false;
            }
            return prevLoading;
        });
    }, 20000);
  }

  // ✅ FUNÇÃO PARA DELETAR NO GERENCIAAPP (VIA EXTENSÃO)
  async function handleDeleteApp(appName: string) {
    if (!username.trim()) {
      addToast("warning", "Atenção", "O Usuário precisa estar preenchido para buscar e deletar.");
      return;
    }

    // Busca o MAC (se existir) para o fallback
    const currentApp = selectedApps.find(a => a.name === appName);
    let macValue = "";
    if (currentApp) {
        const macField = currentApp.fields_config?.find((f: any) => String(f?.type || "").toUpperCase() === "MAC");
        if (macField) {
            const key = String(macField.id || macField.label || "").trim();
            macValue = currentApp.values[key] || "";
        }
        if (!macValue) {
            const foundKey = Object.keys(currentApp.values).find(k => String(currentApp.values[k]).includes(":"));
            if (foundKey) macValue = currentApp.values[foundKey];
        }
    }

    setLoading(true);
    setLoadingStep("A remover do Painel...");

    const payloadDelete = {
        username: username.trim(),
        mac_device: macValue || ""
    };

    const responseHandler = (e: any) => {
        window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
        setLoading(false);
        setLoadingStep("");

        const result = e.detail;
        if (result && result.ok) {
            addToast("success", "Removido!", "Configuração apagada do GerenciaApp com sucesso.");
        } else {
            addToast("error", "Não Removido", result?.error || "Falha ao apagar no painel.");
        }
    };

    window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);

    window.dispatchEvent(new CustomEvent("UNIGESTOR_INTEGRATION_CALL", {
        detail: {
            action: "GERENCIAAPP_DELETE",
            payload: payloadDelete
        }
    }));

    setTimeout(() => {
        setLoading((prevLoading) => {
            if (prevLoading) {
                window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
                addToast("warning", "Aviso", "A resposta demorou. Verifique no painel se foi apagado.");
                setLoadingStep("");
                return false;
            }
            return prevLoading;
        });
    }, 20000);
  }

  // 1. EXECUTA A GRAVAÇÃO REAL (Chamada direta ou pelo botão do Popup)
async function executeSave() {

    setConfirmModal(null); // Fecha o popup se estiver aberto

    setLoading(true);

    setLoadingStep("Iniciando..."); // ✅



    try {

      // Recalcula variáveis necessárias para o envio (garante dados frescos)

      const tid = await getCurrentTenantId();

      

      const rawPrimaryDigits = onlyDigits(primaryPhoneRaw);
// ✅ Usa o DDI já identificado no label (evita re-inferir errado com número nacional sem prefixo)
const ddi = rawPrimaryDigits ? extractDdiFromLabel(primaryCountryLabel) : "55";
const nationalDigits = rawPrimaryDigits.startsWith(ddi) ? rawPrimaryDigits.slice(ddi.length) : rawPrimaryDigits;
const finalPrimaryE164 = rawPrimaryDigits ? `+${ddi}${nationalDigits}` : "";



      const rawSecondaryDigits = onlyDigits(secondaryPhoneRaw);
let finalSecondaryE164 = null;
if (rawSecondaryDigits) {
  // ✅ Mesma lógica: usa o DDI do label para não perder o país
  const ddi2 = extractDdiFromLabel(secondaryCountryLabel);
  const nat2 = rawSecondaryDigits.startsWith(ddi2) ? rawSecondaryDigits.slice(ddi2.length) : rawSecondaryDigits;
  finalSecondaryE164 = `+${ddi2}${nat2}`;
}
      
      const secName = secondaryName.trim() ? secondaryName.trim() : null;
      const secPrefix = secondarySalutation?.trim() ? secondarySalutation.trim() : null;
      const secWhatsUser = secondaryWhatsappUsername.trim() ? secondaryWhatsappUsername.trim() : null;



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

      // ✅ Converte a data de cadastro para envio
      const finalCreatedAt = createdAt ? localDateTimeToISO(createdAt) : null;

      // Dados do RPC
      const { data: userRes } = await supabaseBrowser.auth.getUser();
      const createdBy = userRes?.user?.id;



      const rpcTable = selectedTable; // ✅ TRIAL agora usa a tabela selecionada no UI

const rpcPeriod = (isTrialMode ? "MONTHLY" : selectedPlanPeriod) as any;

const rpcScreens = isTrialMode ? 1 : Number(screens || 1);



// ✅ valor vem da tabela automaticamente via useEffect quando priceTouched=false

// ✅ e vira override quando você digita (priceTouched=true)

const rpcPriceAmount = safeNumberFromMoneyBR(planPrice);



// ✅ moeda sempre vem da tabela selecionada (e já é refletida no state via useEffect)

const rpcCurrency = (currency || "BRL");



const rpcPlanLabel = isTrialMode ? PLAN_LABELS["MONTHLY"] : PLAN_LABELS[selectedPlanPeriod];



      let clientId = clientToEdit?.id;
let apiM3uUrl = ""; // ✅ Hoistado para fora do else
let finalM3u = ""; // ✅ Calculado no momento certo em cada bloco

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
          p_plan_table_id: selectedTableId || null,
          p_price_amount: rpcPriceAmount,
          p_price_currency: rpcCurrency as any,
          p_vencimento: dueISO,
          p_notes: notes?.trim() ? notes.trim() : null,
          p_clear_notes: Boolean(isEditing && !notes?.trim()),

          p_phone_e164: finalPrimaryE164 || null,
          p_whatsapp_username: whatsappUsername || null,
          p_whatsapp_opt_in: Boolean(whatsappOptIn),
          p_whatsapp_snooze_until: snoozeISO,
          p_clear_whatsapp_snooze_until: clearSnooze,
          p_is_trial: isTrialMode,
          p_name_prefix: namePrefix,
          p_technology: finalTechnology,

          p_secondary_display_name: secName,
          p_secondary_name_prefix: secPrefix,
          p_secondary_phone_e164: finalSecondaryE164,
          p_secondary_whatsapp_username: secWhatsUser,
          p_clear_secondary: (!secName && !finalSecondaryE164),
        });

        if (error) {
          addToast("error", "Erro ao atualizar", error.message);
          throw error;
        }



        // ✅ ATUALIZAR M3U_URL E DATA DE CADASTRO (também na edição)
// ✅ Na edição, password já está no state — calcula aqui
finalM3u = (m3uUrl || buildM3uUrlSilent() || "").trim();

const patchEdit: any = {};
if (finalM3u) patchEdit.m3u_url = finalM3u;
if (finalCreatedAt) patchEdit.created_at = finalCreatedAt;

if (Object.keys(patchEdit).length > 0) {
  console.log("🟢 [EDIÇÃO] Atualizando dados extras (M3U / Data):", patchEdit);
  
  // ✅ Delay de segurança
  await new Promise(resolve => setTimeout(resolve, 50));
  
  const { data: patchResult, error: patchErr } = await supabaseBrowser
    .from("clients")
    .update(patchEdit)
    .eq("id", clientId)
    .eq("tenant_id", tid)
    .select();
  
  if (patchErr) {
    console.error("❌ Erro ao atualizar M3U/Data:", patchErr);
  } else {
    console.log("✅ M3U/Data atualizado com sucesso!", patchResult);
  }
}



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

      

      // ✅ NOVO: Variáveis para dados da API

      // ✅ Normalização: Remove espaços e acentos, mas MANTÉM maiúsculas e minúsculas

      let apiUsername = username.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "");

      let apiPassword = password?.trim() || "";

      let apiVencimento = dueISO;

apiM3uUrl = ""; // já declarado acima

// ✅ NOVO: external_user_id retornado pela integração (ex.: ELITE)

let apiExternalUserId = "";

let serverName = "Servidor"; // ✅ DECLARAR AQUI (escopo correto)





// ✅ NOVO: Se marcou "Sincronizar com Servidor" E tem servidor E FOR TESTE (Cliente agora é só local), chama API
      if (isTrialMode && syncWithServer && serverId) {
        let apiUrl = ""; // ✅ FIX: escopo correto (visível no try e no catch)



  try {

    // 1. Buscar integração do servidor

    const { data: srv, error: srvErr } = await supabaseBrowser

      .from("servers")

      .select("panel_integration")

      .eq("id", serverId)

      .single();



    if (srvErr) throw new Error("Erro ao buscar servidor: " + srvErr.message);



    if (srv?.panel_integration) {

      // 2. Buscar provider

      const { data: integ, error: integErr } = await supabaseBrowser

        .from("server_integrations")

        .select("provider")

        .eq("id", srv.panel_integration)

        .single();



      if (integErr) throw new Error("Erro ao buscar integração: " + integErr.message);



      const provider = String(integ?.provider || "").toUpperCase();



      // ✅ pega do state já carregado (sem query extra)

serverName = servers.find((s) => s.id === serverId)?.name || "Servidor";



      // 3. Montar URL da API (Apenas Testes usam API agora)
      apiUrl = "";

      if (provider === "FAST") apiUrl = "/api/integrations/fast/create-trial";
      else if (provider === "NATV") apiUrl = "/api/integrations/natv/create-trial";
      else if (provider === "ELITE") apiUrl = "/api/integrations/elite/create-trial";

      if (!apiUrl) {
        throw new Error("Provider não suportado para integração automática de testes.");
      }



      // 4. Montar payload

      const apiPayload: any = {

        integration_id: srv.panel_integration,

        tenant_id: tid, // ✅ INCLUÍDO: O Elite exige o envio explícito do tenant_id

        username: apiUsername,

        password: apiPassword || undefined,



        // ✅ NOVO: manda a tecnologia que o usuário escolheu no modal

        technology: finalTechnology,



        // ✅ opcional (se você quiser já usar no create-trial sem depender do sync)

        notes: notes?.trim() ? notes.trim() : null,

      };



      if (isTrialMode) {

        apiPayload.hours = testHours;

      } else {

        apiPayload.months = PLAN_MONTHS[selectedPlanPeriod] || 1;

        apiPayload.screens = Number(screens);

      }



// 5) Chamar API (com leitura segura + suporte a formatos diferentes)

      setLoadingStep("Conectando..."); // ✅

      const { data: sess, error: sessErr } = await supabaseBrowser.auth.getSession();

const token = sess?.session?.access_token;



if (sessErr) throw new Error(`Sessão inválida: ${sessErr.message}`);

if (!token) throw new Error("Sem sessão ativa. Recarregue a página e faça login novamente.");



const apiRes = await fetch(apiUrl, {

  method: "POST",

  credentials: "include", // ✅ garante cookies se sua rota usa createRouteHandlerClient

  headers: {

    "Content-Type": "application/json",

    Authorization: `Bearer ${token}`, // ✅ sempre manda

  },

  body: JSON.stringify(apiPayload),

});



const apiText = await apiRes.text();



// parse seguro

let apiJson: any = null;

try {

  apiJson = apiText ? JSON.parse(apiText) : null;

} catch {

  apiJson = null;

}



// ✅ aceita variações comuns: ok / success / status

const okFlag =

  Boolean(apiJson?.ok) ||

  Boolean(apiJson?.success) ||

  String(apiJson?.status || "").toLowerCase() === "ok";



// se não ok, tenta extrair erro do JSON, senão usa o texto bruto

if (!apiRes.ok || !okFlag) {

  const errMsg =

    apiJson?.error ||

    apiJson?.message ||

    (apiText && apiText.slice(0, 300)) ||

    `Falha integração (HTTP ${apiRes.status})`;



  throw new Error(errMsg);

}



      // ✅ Normaliza retorno:

      // - Alguns endpoints retornam { ok:true, data:{...} }

      // - O seu ELITE create-trial retorna { ok:true, username, password, ... } (sem data)

      const apiData =

        apiJson &&

        typeof apiJson === "object" &&

        apiJson.data &&

        typeof apiJson.data === "object"

          ? apiJson.data

          : apiJson;



      // 6) Atualizar dados com resposta (sem quebrar se algum campo não vier)

      const nextUsername = apiData?.username != null ? String(apiData.username) : "";

      const nextPassword = apiData?.password != null ? String(apiData.password) : "";

      const nextM3u =

  apiData?.m3u_url != null

    ? String(apiData.m3u_url)

    : apiData?.m3uUrl != null

      ? String(apiData.m3uUrl)

      : "";



const nextExternalUserIdRaw =

  apiData?.external_user_id ??

  apiData?.externalUserId ??

  apiData?.external_id ??

  apiData?.user_id ??

  apiData?.id ??

  "";



const nextExternalUserId = String(nextExternalUserIdRaw || "").trim();



if (nextUsername) apiUsername = nextUsername;

if (nextPassword) apiPassword = nextPassword;

if (nextM3u) apiM3uUrl = nextM3u;



if (nextExternalUserId) {

  apiExternalUserId = nextExternalUserId;

  setExternalUserId(nextExternalUserId); // ✅ reflete na UI/estado

}



      // ✅ Log higienizado: removemos o "password" para não vazar no console (F12)
      console.log("🔵 Dados recebidos da API:", {
        username: apiUsername,
        m3u_url: apiM3uUrl,
        exp_date: apiData?.exp_date,
      });

// ✅ Reflete na UI imediatamente (Exceto o Username, para mantermos o original na tela para o Sync!)

      if (apiPassword) setPassword(apiPassword);

      if (apiM3uUrl) setM3uUrl(apiM3uUrl);



      // exp_date pode vir em segundos OU ms (blindagem)

      const expRaw = apiData?.exp_date ?? null;

      if (expRaw != null) {

        const n = Number(expRaw);

        if (Number.isFinite(n) && n > 0) {

          const ms = n > 1e12 ? n : n * 1000; // se já vier em ms, não multiplica

          const expDate = new Date(ms);

          if (Number.isFinite(expDate.getTime())) {

            apiVencimento = expDate.toISOString();

          }

        }

      }



            // ✅ 6.1) TRIAL ELITE: Toast "Teste criado" + Sync de normalização (username/vencimento) UMA ÚNICA VEZ

      if (isTrialMode && provider === "ELITE") {

        // 1) Toast: teste criado OK (após create-trial)

        queueListToast("trial", {

          type: "success",

          title: "Teste criado",

          message: `Teste criado no servidor ${serverName}.`,

        });



// 2) Chamar /elite/create-trial/sync para normalizar username + vencimento

        try {

          setLoadingStep("Sincronizando..."); // ✅

          const syncTrialUrl = "/api/integrations/elite/create-trial/sync";



const syncTrialRes = await fetch(syncTrialUrl, {

            method: "POST",

            credentials: "include",

            headers: {

              "Content-Type": "application/json",

              ...(token ? { Authorization: `Bearer ${token}` } : {}),

            },

body: JSON.stringify({

              ...apiPayload, // Mantém integração, notas, etc.

              external_user_id: apiExternalUserId, // ✅ CRÍTICO: O ID retornado pelo create-trial

              desired_username: username,          // ✅ O nome que você digitou (ex: MarcioNaTV)

              username: apiUsername,               // O nome numérico (ex: 199797...)

              server_username: apiUsername,        // ✅ NOVO: Chave para o fallback do banco buscar o cliente

              client_id: clientId,                 // ✅ NOVO: Chave para o fallback do banco buscar o cliente

              technology: finalTechnology          // ✅ IPTV ou P2P para o roteamento

            }),

          });



          const syncTrialText = await syncTrialRes.text();



          let syncTrialJson: any = null;

          try {

            syncTrialJson = syncTrialText ? JSON.parse(syncTrialText) : null;

          } catch {

            syncTrialJson = null;

          }



          const syncOkFlag =

            Boolean(syncTrialJson?.ok) ||

            Boolean(syncTrialJson?.success) ||

            String(syncTrialJson?.status || "").toLowerCase() === "ok";



          if (!syncTrialRes.ok || !syncOkFlag) {

            const errMsg =

              syncTrialJson?.error ||

              syncTrialJson?.message ||

              (syncTrialText && syncTrialText.slice(0, 300)) ||

              `Falha sync trial ELITE (HTTP ${syncTrialRes.status})`;



            throw new Error(errMsg);

          }



          // Aceita { ok:true, data:{...} } ou { ok:true, ... }

          const syncData =

            syncTrialJson &&

            typeof syncTrialJson === "object" &&

            syncTrialJson.data &&

            typeof syncTrialJson.data === "object"

              ? syncTrialJson.data

              : syncTrialJson;



          // aplica retorno se vier

          const sUser = syncData?.username != null ? String(syncData.username).trim() : "";

          const sPass = syncData?.password != null ? String(syncData.password) : "";

          const sM3u =

            syncData?.m3u_url != null

              ? String(syncData.m3u_url)

              : syncData?.m3uUrl != null

                ? String(syncData.m3uUrl)

                : "";



          if (sUser) apiUsername = sUser;

          if (sPass) apiPassword = sPass;

          if (sM3u) apiM3uUrl = sM3u;



          // exp_date pode vir em segundos ou ms

          const exp2 = syncData?.exp_date ?? null;

          if (exp2 != null) {

            const n2 = Number(exp2);

            if (Number.isFinite(n2) && n2 > 0) {

              const ms2 = n2 > 1e12 ? n2 : n2 * 1000;

              const dt2 = new Date(ms2);

              if (Number.isFinite(dt2.getTime())) {

                apiVencimento = dt2.toISOString();



                // ✅ reflete na UI (opcional, mas ajuda a ver que “corrigiu”)

                setDueDate(`${dt2.getFullYear()}-${pad2(dt2.getMonth() + 1)}-${pad2(dt2.getDate())}`);

                setDueTime(`${pad2(dt2.getHours())}:${pad2(dt2.getMinutes())}`);

              }

            }

          }



          // ✅ reflete na UI imediatamente

          if (apiUsername) setUsername(apiUsername);

          if (apiPassword) setPassword(apiPassword);

          if (apiM3uUrl) setM3uUrl(apiM3uUrl);



          // 3) Toast: dados sincronizados OK

          queueListToast("trial", {

            type: "success",

            title: "Dados sincronizados",

            message: `Dados sincronizados com servidor ${serverName}.`,

          });

        } catch (syncErr: any) {

          const msg = String(syncErr?.message || syncErr || "").trim();



          queueListToast("trial", {

            type: "error",

            title: "Falha ao sincronizar",

            message: `Teste criado, mas a sincronização falhou${msg ? `: ${msg}` : ""}.`,

          });

        }

      }



      // 7) Sync (atualizar saldo do servidor) — mantém como estava

      const syncUrl =

        provider === "FAST"

          ? "/api/integrations/fast/sync"

          : provider === "NATV"

            ? "/api/integrations/natv/sync"

            : provider === "ELITE"

              ? "/api/integrations/elite/sync"

              : "";



      if (syncUrl) {

        const syncRes = await fetch(syncUrl, {

          method: "POST",

          headers: {

            "Content-Type": "application/json",

            ...(token ? { Authorization: `Bearer ${token}` } : {}),

          },

body: JSON.stringify({ 

            integration_id: srv.panel_integration,

            external_user_id: apiExternalUserId, // ✅ O ID gerado na criação (Ex: 5672425)

            desired_username: username,          // ✅ O nome "bonito" que você digitou na tela

            username: apiUsername,               // ✅ O nome "feio" que o painel devolveu primeiro

            server_username: apiUsername,        // ✅ NOVO: Chave para o fallback do banco buscar o cliente

            client_id: clientId,                 // ✅ NOVO: Chave para o fallback do banco buscar o cliente

            notes: notes?.trim() ? notes.trim() : null,

            technology: finalTechnology          // ✅ A CHAVE MESTRA: "IPTV" ou "P2P"

          }),

        });



        if (!syncRes.ok) {

          const t = await syncRes.text().catch(() => "");

          console.warn("⚠️ Sync falhou:", syncRes.status, t);

        } else {

          // Se o Sync der certo, podemos pegar os dados atualizados para salvar bonito no banco local

          const syncData = await syncRes.json().catch(() => ({}));

          if (syncData?.username) apiUsername = syncData.username;

          if (syncData?.password) apiPassword = syncData.password;

          if (syncData?.expires_at_iso) apiVencimento = syncData.expires_at_iso;

        }

      }



      // ✅ ENFILEIRAR Toast de sucesso da API (Agora é exclusivo de Testes)
      // (no TRIAL + ELITE, você já terá os 2 toasts: "Teste criado" e "Dados sincronizados")
      if (!(provider === "ELITE")) {
        queueListToast("trial", {
          type: "success",
          title: "🎉 Teste Automático!",
          message: `Teste criado com sucesso no servidor ${serverName}.`,
        });
      }
    }

  } catch (apiErr: any) {
    const msg = String(apiErr?.message || apiErr || "").trim();

    console.error("Erro ao chamar API de Teste:", { apiUrl, apiErr, msg });

    queueListToast("trial", {
      type: "error",
      title: "Teste Manual Criado",
      message: `Integração falhou${msg ? `: ${msg}` : ""}. Teste salvo apenas localmente (sem painel).`,
    });
  }
}



// ✅ SALVAR NO BANCO (com dados da API se tiver, ou do form se não)

  setLoadingStep("Salvando..."); // ✅

  const { data, error } = await supabaseBrowser.rpc("create_client_and_setup", {
    p_tenant_id: tid,
    p_created_by: createdBy,
    p_display_name: displayName,
    p_server_id: serverId,
    p_server_username: apiUsername,
    p_server_password: apiPassword,
    p_screens: rpcScreens,
    p_plan_label: rpcPlanLabel,
    p_plan_table_id: selectedTableId || null,
    p_price_amount: rpcPriceAmount,
    p_price_currency: rpcCurrency as any,
    p_vencimento: apiVencimento,
    p_phone_e164: finalPrimaryE164 || null,
    p_whatsapp_username: whatsappUsername || null,
    p_whatsapp_opt_in: Boolean(whatsappOptIn),
    p_whatsapp_snooze_until: snoozeISO,
    p_clear_whatsapp_snooze_until: clearSnooze,
    p_name_prefix: namePrefix,
    p_notes: notes || null,
    p_app_ids: [],
    p_is_trial: isTrialMode,
    p_is_archived: false,
    p_technology: finalTechnology,

    p_secondary_display_name: secName,
    p_secondary_name_prefix: secPrefix,
    p_secondary_phone_e164: finalSecondaryE164,
    p_secondary_whatsapp_username: secWhatsUser,
  });



  if (error) {

    addToast("error", "Erro ao criar cliente", error.message);

    throw error;

  }



  



clientId = data;



// ✅ Log de criação no client_events

if (clientId) {

  const isAutomatic = syncWithServer && hasIntegration;

  const creationMsg = isTrialMode

    ? isAutomatic

      ? `Teste criado automaticamente via ${serverName} (${trialProvider}) · Vencimento: ${new Date(apiVencimento).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`

      : `Teste criado manualmente · Vencimento: ${new Date(apiVencimento).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`

    : isAutomatic

      ? `Cliente criado automaticamente via ${serverName} (${trialProvider}) · Vencimento: ${new Date(apiVencimento).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`

      : `Cliente criado manualmente · Vencimento: ${new Date(apiVencimento).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;



  await supabaseBrowser.from("client_events").insert({

    tenant_id: tid,

    client_id: clientId,

    event_type: isTrialMode ? "TRIAL_CREATED" : "CLIENT_CREATED",

    message: creationMsg,

    meta: {

      automatic: isAutomatic,

      provider: trialProvider,

      server_name: serverName,

      new_vencimento: apiVencimento,

      ...(isTrialMode ? { trial_hours: testHours } : { screens: rpcScreens, months: PLAN_MONTHS[selectedPlanPeriod] }),

    },

  });

}



// ✅ ATUALIZAR M3U_URL (API ou manual)

console.log("🔵 DEBUG M3U antes de salvar:", {

  clientId,

  apiM3uUrl,

  m3uUrl,

  finalValue: apiM3uUrl || m3uUrl

});



// ✅ UPDATE ÚNICO (evita writes extras): m3u_url + external_user_id + created_at

// ✅ Na criação, usa apiUsername/apiPassword que já vieram da API (ou do form se manual)
finalM3u = (apiM3uUrl || m3uUrl || buildM3uUrlSilent(apiUsername, apiPassword) || "").trim();

const finalExternalUserId = (apiExternalUserId || externalUserId || "").trim();

if (clientId && (finalM3u || finalExternalUserId || finalCreatedAt)) {
  const patch: any = {};
  if (finalM3u) patch.m3u_url = finalM3u;
  if (finalExternalUserId) patch.external_user_id = finalExternalUserId;
  if (finalCreatedAt) patch.created_at = finalCreatedAt; // ✅ ADICIONADO

  console.log("🟢 Salvando PATCH no banco:", patch);



  // ✅ Delay de segurança (mantém seu padrão)

  await new Promise((resolve) => setTimeout(resolve, 100));



  const { data: updateResult, error: patchErr } = await supabaseBrowser

    .from("clients")

    .update(patch)

    .eq("id", clientId)

    .eq("tenant_id", tid)

    .select();



  if (patchErr) {

    console.error("❌ Erro ao salvar PATCH:", patchErr);

  } else {

    console.log("✅ PATCH salvo com sucesso!", updateResult);

  }

} else {

  console.warn("⚠️ PATCH NÃO salvo. Motivo:", {

    temClientId: !!clientId,

    temM3uFinal: !!finalM3u,

    temExternalUserId: !!finalExternalUserId,

  });

}





        if (selectedApps.length > 0 && clientId) {
            const toInsert = selectedApps.map(app => ({
                client_id: clientId, tenant_id: tid, app_id: app.app_id,
                field_values: { ...app.values, _config_cost: app.costType, _config_partner: app.partnerServerId }
            }));
            await supabaseBrowser.from("client_apps").insert(toInsert);

            // ✅ CHAMA A API DO APP SEQUENCIALMENTE ANTES DO WHATSAPP (SÓ NA CRIAÇÃO)
            if (!isEditing) {
              for (const app of selectedApps) {
                const catApp = catalog.find(c => c.id === app.app_id) as any;
                if (catApp?.integration_type && app.auto_configure !== false) {
                  try {
                    setLoadingStep(`Painel: ${app.name}...`);
                    
                    // ✅ Monta os dados atualizados com o retorno da API (apiUsername, apiPassword, etc)
                    const selectedServerName = servers.find((s) => s.id === serverId)?.name || "Servidor";
                    const shortServerName = selectedServerName.replace(/\s+/g, "");
                    const finalServerName = `${apiUsername}_${shortServerName}`;

                    // ✅ Calcula a data exata de 1 ano para frente a partir de hoje (À prova de Anos Bissextos)
                    const dAutomacao = new Date();
                    dAutomacao.setFullYear(dAutomacao.getFullYear() + 1);
                    const expireAutomacao1Year = `${dAutomacao.getFullYear()}-${String(dAutomacao.getMonth() + 1).padStart(2, '0')}-${String(dAutomacao.getDate()).padStart(2, '0')}`;

                    // ✅ Busca o MAC de forma CORRETA na Automação
                    let macValueAuto = "";
                    const macFieldAuto = app.fields_config?.find((f: any) => String(f?.type || "").toUpperCase() === "MAC");
                    if (macFieldAuto) {
                        const keyAuto = String(macFieldAuto.id || macFieldAuto.label || "").trim();
                        macValueAuto = app.values[keyAuto] || "";
                    }
                    if (!macValueAuto) {
                        const foundKeyAuto = Object.keys(app.values).find(k => String(app.values[k]).includes(":"));
                        if (foundKeyAuto) macValueAuto = app.values[foundKeyAuto];
                    }

                    if (!macValueAuto || macValueAuto.trim() === "") {
                        console.warn(`[Automação] App ${app.name} ignorado pois o MAC não foi encontrado.`);
                        continue; 
                    }

                    // ✅ Payload blindado com as SUAS regras estritas
                    const payloadAutomacao = {
                        modo_selecao: 1,
                        mac_device: macValueAuto,
                        server_name: finalServerName,
                        account_username: "",
                        account_password: "",
                        xteam_username: "",
                        xteam_password: "",
                        username_login: apiUsername,
                        password_login: apiPassword || "",
                        ranking_app_id: 10,
                        dns: "",
                        m3u8_list: finalM3u || apiM3uUrl || m3uUrl || "",
                        url_epg: "",
                        price: 0,
                        plan_id: "",
                        expire_date: expireAutomacao1Year, 
                        dnsOptions: "",
                        whatsapp: "",
                        is_trial: 0,
                        
                    };

                    // ✅ Usa a Extensão do Chrome para furar o Cloudflare e criar silenciosamente!
                    await new Promise((resolve) => {
                        const handler = (e: any) => {
                            window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", handler);
                            if (e.detail?.ok) {
                                queueListToast("trial", { type: "success", title: "App Integrado", message: `${app.name} ativado com sucesso!` });
                            } else {
                                queueListToast("trial", { type: "error", title: "Aviso do App", message: `Falha ao integrar ${app.name}.` });
                            }
                            resolve(true);
                        };
                        window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", handler);
                        
                        window.dispatchEvent(new CustomEvent("UNIGESTOR_INTEGRATION_CALL", {
                            detail: { action: "GERENCIAAPP_CREATE", payload: payloadAutomacao }
                        }));

                        // Timeout de segurança para não travar a tela se a extensão falhar
                        setTimeout(() => {
                            window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", handler);
                            resolve(false);
                        }, 12000);
                    });

                  } catch (errApp) {
                    console.error("Falha na automação do App:", app.name, errApp);
                  }
                }
              }
            }
        }

// ✅ TRIAL: enviar mensagem de teste imediatamente + toast na tela de testes

if (isTrialMode && sendTrialWhats && messageContent && messageContent.trim() && clientId) {

  try {

    setLoadingStep("WhatsApp..."); // ✅

    const { data: session } = await supabaseBrowser.auth.getSession();

    const token = session.session?.access_token;



// ✅ BUSCA O TEMPLATE INTEIRO PARA PEGAR A IMAGEM (se foi escolhido um modelo)
    let imageUrlToSend = null;
    if (selectedTemplateId) {
      const tpl = templates.find((t) => t.id === selectedTemplateId);
      if (tpl && tpl.image_url) {
        imageUrlToSend = tpl.image_url;
      }
    }

    const res = await fetch("/api/whatsapp/envio_agora", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenant_id: tid,
        client_id: clientId,
        message: messageContent,
        message_template_id: selectedTemplateId || null,
        image_url: imageUrlToSend, // ✅ ENVIA A IMAGEM AQUI!
        whatsapp_session: selectedSession, // ✅ Usando a sessão selecionada
      }),
    });



    if (!res.ok) {

      throw new Error("API retornou erro");

    }



    // ✅ Toast vai para a LISTA DE TESTES

    queueListToast("trial", {

      type: "success",

      title: "Mensagem enviada",

      message: "Mensagem de teste entregue no WhatsApp.",

    });

  } catch (e) {

    console.error("Falha envio Whats (teste):", e);



    queueListToast("trial", {

      type: "error",

      title: "Erro no envio",

      message: "Teste criado, mas o WhatsApp falhou.",

    });

  }

}



      }



      // ✅ RENOVAÇÃO AUTOMÁTICA: SOMENTE NA CRIAÇÃO (nunca na edição)

if (!isEditing && !isTrialMode && registerRenewal && clientId) {

  const monthsToRenew = Number(PLAN_MONTHS[selectedPlanPeriod] ?? 1);



  // ✅ DE/PARA — no cadastro não há vencimento anterior

  const newVenc = new Date(dueISO).toLocaleString("pt-BR", {

  timeZone: "America/Sao_Paulo",

  day: "2-digit", month: "2-digit", year: "numeric",

  hour: "2-digit", minute: "2-digit",

});



const renewServerName = servers.find((s) => s.id === serverId)?.name || "Servidor";

const isAutomatic = syncWithServer && hasIntegration;

const renewMsg = isAutomatic ?

  `Renovação automática no cadastro via ${renewServerName} (${trialProvider}) · ${monthsToRenew} mês(es) · ${rpcScreens} tela(s) · ${fmtMoney(rpcCurrency, rpcPriceAmount)} · De: — → Para: ${newVenc}` :

  `Renovação manual no cadastro · ${monthsToRenew} mês(es) · ${rpcScreens} tela(s) · ${fmtMoney(rpcCurrency, rpcPriceAmount)} · De: — → Para: ${newVenc}`;



const { error: renewError } = await supabaseBrowser.rpc("renew_client_and_log", {

    p_tenant_id: tid,

    p_client_id: clientId,

    p_months: monthsToRenew,

    p_status: "PAID",

    p_notes: notes || null,

    p_new_vencimento: dueISO,

    p_message: renewMsg,

    p_unit_price: Number((totalBrl / monthsToRenew).toFixed(2)), // ✅ Unitário real em BRL

    p_total_amount: totalBrl, // ✅ Total final financeiro cravado em BRL

  });





  if (renewError) {

    addToast("error", "Falha ao registrar renovação", renewError.message);

  } else {

    queueListToast("client", { type: "success", title: "Cliente renovado", message: "Renovação registrada com sucesso." });

    

    // ✅ NOVO: Enviar WhatsApp se marcado (igual ao teste)

    if (sendPaymentMsg && messageContent && messageContent.trim()) {

      try {

        const { data: session } = await supabaseBrowser.auth.getSession();

        const token = session.session?.access_token;



        // ✅ BUSCA O TEMPLATE INTEIRO PARA PEGAR A IMAGEM (se foi escolhido um modelo)
        let paymentImageUrl = null;
        if (selectedTemplateId) {
          const tpl = templates.find((t) => t.id === selectedTemplateId);
          if (tpl && tpl.image_url) {
            paymentImageUrl = tpl.image_url;
          }
        }

        const res = await fetch("/api/whatsapp/envio_agora", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            tenant_id: tid,
            client_id: clientId,
            message: messageContent,
            message_template_id: selectedTemplateId || null,
            image_url: paymentImageUrl, // ✅ ENVIA A IMAGEM AQUI!
            whatsapp_session: selectedSession, // ✅ Usando a sessão selecionada
          }),
        });



        if (!res.ok) throw new Error("API retornou erro");



        queueListToast("client", {

          type: "success",

          title: "Mensagem enviada",

          message: "Comprovante entregue no WhatsApp.",

        });

      } catch (e) {

        console.error("Falha envio Whats (renovação):", e);

        queueListToast("client", {

          type: "error",

          title: "Erro no envio",

          message: "Cliente criado, mas o WhatsApp falhou.",

        });

      }

    }

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



// ✅ NOVO: Gera M3U URL baseado nas DNSs do servidor

// ✅ Gera M3U URL sem side effects (usado internamente no executeSave)
function buildM3uUrlSilent(overrideUser?: string, overridePass?: string): string {
  const user = (overrideUser ?? username).trim();
  const pass = (overridePass ?? password)?.trim() || "";
  if (!user || serverDomains.length === 0) return "";
  const randomDomain = serverDomains[Math.floor(Math.random() * serverDomains.length)];
  const cleanDomain = randomDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `http://${cleanDomain}/get.php?username=${user}&password=${pass}&type=m3u_plus&output=ts`;
}

// ✅ NOVO: Gera M3U URL baseado nas DNSs do servidor
function generateM3uUrl() {

  if (!username.trim()) {

    addToast("warning", "Atenção", "Preencha o usuário primeiro.");

    return;

  }



  if (serverDomains.length === 0) {

    addToast("warning", "Sem Domínios", "Este servidor não possui domínios configurados.");

    return;

  }



  // Escolhe domínio aleatório

  const randomDomain = serverDomains[Math.floor(Math.random() * serverDomains.length)];

  

  // Remove protocolo se houver

  const cleanDomain = randomDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  

  // Gera URL

  const user = username.trim();

  const pass = password?.trim() || "";

  const url = `http://${cleanDomain}/get.php?username=${user}&password=${pass}&type=m3u_plus&output=ts`;

  

  setM3uUrl(url);

  addToast("success", "Link Gerado!", "M3U URL atualizado com sucesso.");

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



    // ✅ Só confirma "cadastro + renovação" quando for CRIAÇÃO (nunca na edição)

if (!isEditing && registerRenewal && !isTrialMode) {

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

      <div className="fixed inset-x-0 top-2 z-[999999] px-3 sm:px-6 pointer-events-none">

  <div className="pointer-events-auto">

    <ToastNotifications toasts={toasts} removeToast={removeToast} />

  </div>

</div>



<div
  className="fixed inset-0 z-[99990] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-hidden overscroll-contain animate-in fade-in duration-200"
  onPointerDown={(e) => {
    // ✅ CORREÇÃO: Só fecha se clicar (começar o clique) exatamente no fundo, não se arrastar pra fora.
    if (e.target === e.currentTarget) onClose();
  }}
>
<div
  className="w-full max-w-lg sm:max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden min-h-0 max-h-[90vh] transition-all animate-in fade-in zoom-in-95 duration-200"
  style={{ maxHeight: "90dvh" }}
  onPointerDown={(e) => e.stopPropagation()} // Impede que o clique dentro do modal vaze para o fundo
>

          {/* HEADER */}

          <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 rounded-t-xl shrink-0">

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

          <div

  className="p-3 sm:p-4 overflow-y-auto overscroll-contain space-y-3 flex-1 min-h-0 bg-white dark:bg-[#161b22] custom-scrollbar"

  style={{ WebkitOverflowScrolling: "touch" }}

>



            

            {/* TAB: DADOS */}

            {activeTab === "dados" && (

              <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">

                

                {/* Saudação + Nome */}

                <div className="grid grid-cols-4 gap-3">

                  <div className="col-span-1">

                    <Label>Saudação</Label>

                    <Select value={salutation} onChange={(e) => setSalutation(e.target.value)}>

                      <option value=""> </option>

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
                        const val = e.target.value;
                        setWhatsappUsername(val);
                        setWhatsUserTouched(true);
                        setWaValidation(null);
                        if (waValidateTimer.current) clearTimeout(waValidateTimer.current);
                        waValidateTimer.current = setTimeout(() => {
                          void validateWa(val, setWaValidation, setPrimaryCountryLabel);
                        }, 800);
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
                    {waValidation && (
                      <div className={`mt-1 flex items-center gap-1.5 text-[11px] font-bold ${waValidation.loading ? "text-slate-400" : waValidation.exists ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
                        {waValidation.loading ? (
                          <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Validando...</>
                        ) : waValidation.exists ? (
                          <>✅ WhatsApp ativo</>
                        ) : (
                          <>❌ Não encontrado no WhatsApp</>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* CONTATO SECUNDÁRIO (TOGGLE) */}
                {!showSecondary ? (
                  <div className="pt-2 mt-4 border-t border-slate-200 dark:border-white/10 flex justify-between items-center">
                    <Label> </Label>
                    <button
                      type="button"
                      onClick={() => setShowSecondary(true)}
                      className="text-[10px] px-2 py-0.5 bg-emerald-500/10 rounded text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                    >
                      + ADD CONTATO SECUNDÁRIO
                    </button>
                  </div>
                ) : (
                  <div className="pt-2 mt-4 border-t border-slate-200 dark:border-white/10 space-y-4 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Contato Secundário</h3>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSecondary(false);
                          setSecondaryName("");
                          setSecondarySalutation("");
                          setSecondaryPhoneRaw("");
                          setSecondaryWhatsappUsername("");
                        }}
                        className="text-[10px] px-2 py-0.5 rounded text-rose-500 hover:bg-rose-500/10 font-bold transition-colors"
                        title="Remover Contato Secundário"
                      >
                        REMOVER
                      </button>
                    </div>
                    
                    {/* Saudação + Nome Secundário */}
                    <div className="grid grid-cols-4 gap-3">
                      <div className="col-span-1">
                        <Label>Saudação</Label>
                        <Select value={secondarySalutation} onChange={(e) => setSecondarySalutation(e.target.value)}>
                          <option value=""> </option>
                          <option value="Sr.">Sr.</option>
                          <option value="Sra.">Sra.</option>
                          <option value="Dr.">Dr.</option>
                          <option value="Dra.">Dra.</option>
                          <option value="Dna.">Dna.</option>
                        </Select>
                      </div>
                      <div className="col-span-3">
                        <Label>Nome do contato</Label>
                        <Input value={secondaryName} onChange={(e) => setSecondaryName(e.target.value)} />
                      </div>
                    </div>

                    {/* Telefone + WhatsUser Secundário */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <PhoneRow
                        label="Telefone secundário"
                        countryLabel={secondaryCountryLabel}
                        rawValue={secondaryPhoneRaw}
                        onRawChange={setSecondaryPhoneRaw}
                        onDone={handleDoneSecondary}
                      />

                      <div>
                        <Label>WhatsApp username</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">@</span>
                          <Input
                            className="pl-8 pr-10"
                            value={secondaryWhatsappUsername}
                            onChange={(e) => {
                            const val = e.target.value;
                            setSecondaryWhatsappUsername(val);
                            setSecondaryWhatsUserTouched(true);
                            setSecondaryWaValidation(null);
                            if (secondaryValidateTimer.current) clearTimeout(secondaryValidateTimer.current);
                            secondaryValidateTimer.current = setTimeout(() => {
                              void validateWa(val, setSecondaryWaValidation, setSecondaryCountryLabel);
                            }, 800);
                          }}
                            placeholder="username"
                          />
                          {secondaryWhatsappUsername && (
                            <a
                              href={`https://wa.me/${secondaryWhatsappUsername}`}
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
                        {secondaryWaValidation && (
                          <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-bold ${secondaryWaValidation.loading ? "text-slate-400" : secondaryWaValidation.exists ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
                            {secondaryWaValidation.loading ? (
                              <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Validando...</>
                            ) : secondaryWaValidation.exists ? (
                              <>✅ WhatsApp ativo</>
                            ) : (
                              <>❌ Não encontrado no WhatsApp</>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* DIVISOR PARA SEPARAR DO RESTANTE */}
                    <div className="pt-2 pb-1 border-b border-slate-200 dark:border-white/10"></div>
                  </div>
                )}



                {/* Cadastro + Whats + Não Perturbe */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label>Data Cadastro</Label>
                    <FormattedDateInput
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
                    <FormattedDateInput
                      type="datetime-local"
                      value={dontMessageUntil}
                      onChange={(e) => setDontMessageUntil(e.target.value)}
                      className="h-10 text-xs"
                    />
                  </div>
                </div>



                {/* ✅ SELEÇÃO DA SESSÃO DE WHATSAPP */}
                <div>
                   <Label>Sessão de Disparo (WhatsApp)</Label>
                   <Select value={selectedSession} onChange={(e) => setSelectedSession(e.target.value)}>
                     {sessionOptions.map(s => (
                       <option key={s.id} value={s.id}>{s.label}</option>
                     ))}
                   </Select>
                   <p className="text-[9px] text-slate-400 dark:text-white/30 mt-1 italic">
                     Sessão usada para enviar a mensagem de Boas Vindas, Teste ou Pagamento.
                   </p>
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

                                disabled={trialProvider === "FAST" || trialProvider === "NATV"}

                                className={`h-8 w-[100px] px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded text-xs font-bold text-slate-700 dark:text-white outline-none transition-all ${

                                  (trialProvider === "FAST" || trialProvider === "NATV") 

                                    ? "opacity-60 cursor-not-allowed" 

                                    : "cursor-pointer hover:border-emerald-500/50"

                                }`}

                            >

                                {trialProvider === "FAST" || trialProvider === "NATV" ? (

                                    <option value="IPTV">IPTV</option>

                                ) : trialProvider === "ELITE" ? (

                                    <>

                                      <option value="IPTV">IPTV</option>

                                      <option value="P2P">P2P</option>

                                    </>

                                ) : (

                                    <>

                                      <option value="IPTV">IPTV</option>

                                      <option value="P2P">P2P</option>

                                      <option value="OTT">OTT</option>

                                      {!["IPTV", "P2P", "OTT", "Personalizado"].includes(technology) && (

                                          <option value={technology}>{technology}</option>

                                      )}

                                      <option value="Personalizado">Outro...</option>

                                    </>

                                )}

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

                      {/* ✅ M3U URL (linha toda) */}

<div className="sm:col-span-2">

  <Label>Link M3U (Playlist)</Label>

  <div className="flex gap-2">

    <Input 

      value={m3uUrl} 

      onChange={(e) => setM3uUrl(e.target.value)}

      placeholder="http://dominio/get.php?username=...&password=...&type=m3u_plus&output=ts"

      className="flex-1 text-xs font-mono"

    />

    <button

  type="button"

  onClick={generateM3uUrl}

  disabled={!serverId || !username.trim()}

  className="h-10 px-3 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5"

  title="Gerar link automaticamente"

>

  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">

    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />

  </svg>

  <span className="hidden sm:inline">Gerar</span>

</button>



{/* ✅ BOTÃO COPIAR */}

<button

  type="button"

  onClick={() => {

    if (!m3uUrl.trim()) {

      addToast("warning", "Atenção", "Nenhum link para copiar.");

      return;

    }

    navigator.clipboard.writeText(m3uUrl);

    addToast("success", "Copiado!", "Link M3U copiado para a área de transferência.");

  }}

  disabled={!m3uUrl.trim()}

  className="h-10 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5"

  title="Copiar link M3U"

>

  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">

    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />

  </svg>

  <span className="hidden sm:inline">Copiar</span>

</button>

  </div>

  <p className="text-[9px] text-slate-400 dark:text-white/30 mt-1 italic">

    Gerado automaticamente com base nos domínios do servidor selecionado.

  </p>

</div>

                      

                   </div>

                </div>



                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">

  <div className="flex justify-between items-center gap-3">

    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Plano</span>



    <div className="flex items-center gap-2">

      <span className="text-[10px] text-slate-400 dark:text-white/40 font-bold hidden sm:inline">

        Tabela:

      </span>



      <select

        value={selectedTableId}

        onChange={(e) => setSelectedTableId(e.target.value)}

        className="h-8 w-[120px] px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded text-xs font-bold text-slate-700 dark:text-white outline-none cursor-pointer hover:border-emerald-500/50 transition-all truncate"

      >

        {tables.map((t) => (

          <option key={t.id} value={t.id}>

            {formatTableLabel(t)}

          </option>

        ))}

      </select>

    </div>

  </div>



  {/* ✅ Só CLIENTE vê Plano / Telas / Créditos */}

  {!isTrialMode && (

    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">

      <div className="col-span-2 sm:col-span-1">

        <Label>Plano</Label>

        <Select

          value={selectedPlanPeriod}

          onChange={(e) => setSelectedPlanPeriod(e.target.value as any)}

        >

          {Object.entries(PLAN_LABELS).filter(([k]) => {

              // ✅ Esconde a opção se for Elite

              if (trialProvider === "ELITE" && k === "ANNUAL") return false;

              return true;

            }).map(([k, v]) => (

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

  )}



  {/* ✅ CLIENTE + TRIAL: sempre mostra Moeda + Valor (com override) */}

  <div className="grid grid-cols-3 gap-3">

    <div>

      <Label>Moeda</Label>

      <div className="h-10 w-full bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg flex items-center justify-center text-sm font-bold text-slate-700 dark:text-white">

        {currency}

      </div>

    </div>



    <div className="col-span-2">

      <Label>Valor</Label>

      <Input

        value={planPrice}

        onChange={(e) => {

          setPlanPrice(e.target.value);

          setPriceTouched(true);

        }}

        placeholder="0,00"

        className="text-right font-bold tracking-tight text-lg"

      />

    </div>

  </div>



  {showFx && (

    <div className="p-3 bg-sky-50 dark:bg-sky-500/10 rounded-lg border border-sky-100 dark:border-sky-500/20 grid grid-cols-2 gap-3">

      <div>

        <Label>Câmbio</Label>

        <input

          type="number"

          step="0.0001"

          value={Number(fxRate || 0).toFixed(4)}

          onChange={(e) => setFxRate(Number(e.target.value))}

          className="w-full h-9 px-3 bg-white dark:bg-black/30 border border-sky-200 dark:border-sky-500/20 rounded text-sm outline-none dark:text-white"

        />

      </div>



      <div>

        <Label>Total BRL</Label>

        <div className="w-full h-9 flex items-center justify-center bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/20 rounded text-emerald-800 dark:text-emerald-200 font-bold">

          {fmtMoney("BRL", totalBrl)}

        </div>

      </div>

    </div>

  )}

</div>

                

                {/* VENCIMENTO */}

                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">

   {/* ✅ NOVO: Header com Período ao lado direito (só para teste) */}

   <div className="flex justify-between items-center gap-3">

      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vencimento</span>

      

{isTrialMode && (

  <div className="flex items-center gap-2">

    <span className="text-[10px] text-slate-400 dark:text-white/40 font-bold hidden sm:inline">Período:</span>

    <select

  value={testHours}

  onChange={(e) => setTestHours(Number(e.target.value) as 2 | 4 | 6)}

  disabled={trialHoursLocked}

  title={

    trialProvider === "FAST"

      ? "FAST: período fixo 4h"

      : trialProvider === "ELITE"

        ? "ELITE: período fixo 2h"

        : trialProvider === "NATV"

          ? "NATV: padrão 6h (editável)"

          : "Período do teste"

  }

  className={`h-7 w-[70px] px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded text-xs font-bold text-slate-700 dark:text-white outline-none transition-all ${

    trialHoursLocked ? "opacity-70 cursor-not-allowed" : "cursor-pointer hover:border-emerald-500/50"

  }`}

>

  {trialProvider === "FAST" ? (

    <option value={4}>4h</option>

  ) : trialProvider === "ELITE" ? (

    <option value={2}>2h</option>

  ) : (

    <>

      <option value={2}>2h</option>

      <option value={4}>4h</option>

      <option value={6}>6h</option>

    </>

  )}

</select>

  </div>

)}

   </div>

                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label>Data</Label>
                        <FormattedDateInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="dark:[color-scheme:dark]" />
                      </div>
                      <div>
                        <Label>Hora</Label>
                        <div className="flex gap-2">
                           <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="dark:[color-scheme:dark]" />
                           <button type="button" onClick={() => setDueTime("23:59")} className="px-2 rounded-lg bg-slate-200 dark:bg-white/10 text-[10px] font-bold text-slate-600 dark:text-white/70 hover:bg-slate-300 dark:hover:bg-white/20 border border-slate-300 dark:border-white/20 whitespace-nowrap" title="Fim do dia">23:59</button>
                        </div>
                      </div>
                   </div>

                    {!isEditing && (

                      <>

                        {isTrialMode ? (

                          // ==========================================

                          // LAYOUT MODO TESTE (2 Colunas, Altura Cheia)

                          // ==========================================

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 items-stretch">

                            {/* COLUNA ESQUERDA: Teste Automático Grande */}

                            <div 

                              onClick={() => hasIntegration && setSyncWithServer(!syncWithServer)}

                              className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-center gap-3 ${

                                syncWithServer 

                                  ? "bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/20" 

                                  : "bg-slate-50 border-slate-200 dark:bg-white/5 dark:border-white/10"

                              } ${!hasIntegration ? "opacity-50 cursor-not-allowed" : "h-full"}`}

                            >

                              <div className="flex items-center justify-between w-full">

                                <div className="flex items-center gap-3">

                                  <span className="text-3xl">☁️</span>

                                  <div>

                                    <span className={`text-sm font-bold block ${syncWithServer ? "text-sky-700 dark:text-sky-400" : "text-slate-500"}`}>

                                      Teste Automático

                                    </span>

                                    <span className="text-[10px] text-slate-400 dark:text-white/40">

                                      {hasIntegration ? "Criar direto no painel" : "Sem integração"}

                                    </span>

                                  </div>

                                </div>

                                <Switch checked={syncWithServer} onChange={(v) => hasIntegration && setSyncWithServer(v)} label="" />

                              </div>

                            </div>



                            {/* COLUNA DIREITA: WhatsApp Empilhado */}

                            <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 flex flex-col gap-3">

                              <div

                                onClick={() => setSendTrialWhats(!sendTrialWhats)}

                                className="h-10 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center justify-between gap-3 shrink-0"

                              >

                                <span className="text-xs font-bold text-slate-600 dark:text-white/70">

                                  Enviar msg teste?

                                </span>

                                <Switch checked={sendTrialWhats} onChange={setSendTrialWhats} label="" />

                              </div>



                              {sendTrialWhats && (

                                <div className="animate-in fade-in zoom-in duration-200 shrink-0">

                                  <Select
                                    value={selectedTemplateId}
                                    onChange={(e) => {
                                      const id = e.target.value;
                                      setSelectedTemplateId(id);
                                      const tpl = templates.find((t) => t.id === id);
                                      setMessageContent(tpl?.content || "");
                                    }}
                                    className="h-10 w-full"
                                  >
                                    <option value="">-- Personalizado --</option>
                                    {Object.entries(
                                      templates
                                        // 1. Esconde mensagens de Revendas
                                        .filter(t => t.category !== "Revenda IPTV" && t.category !== "Revenda SaaS")
                                        // 2. Agrupa por categoria
                                        .reduce((acc, t) => {
                                          const cat = t.category || "Geral";
                                          if (!acc[cat]) acc[cat] = [];
                                          acc[cat].push(t);
                                          return acc;
                                        }, {} as Record<string, typeof templates>)
                                    ).map(([catName, tmpls]) => (
                                      <optgroup key={catName} label={`— ${catName} —`}>
                                        {tmpls.map((t) => (
                                          <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                      </optgroup>
                                    ))}
                                  </Select>

                                </div>

                              )}



                              {sendTrialWhats && selectedTemplateId === "" && (

                                <div className="animate-in fade-in zoom-in duration-200 flex-1">

                                  <textarea

                                    value={messageContent}

                                    onChange={(e) => setMessageContent(e.target.value)}

                                    className="w-full h-full min-h-[60px] px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none transition-all"

                                    placeholder="Digite a mensagem de teste..."

                                  />

                                </div>

                              )}

                            </div>

                          </div>

                        ) : (

                          // ==========================================

                          // LAYOUT MODO CLIENTE (2 Linhas)

                          // ==========================================

                          <div className="flex flex-col gap-3 pt-2">

                            

                            {/* LINHA 1: Toggles Lado a Lado */}
                            <div className="grid grid-cols-1 gap-3">
                              
                              {/* ✅ Sincronizar Painel (Oculto na criação de Novo Cliente) */}
                              {(isEditing || isTrialMode) && (
                                <div 
                                  onClick={() => hasIntegration && setSyncWithServer(!syncWithServer)}
                                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                    syncWithServer 
                                      ? "bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/20" 
                                      : "bg-slate-50 border-slate-200 dark:bg-white/5 dark:border-white/10"
                                  } ${!hasIntegration ? "opacity-50 cursor-not-allowed" : ""}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">☁️</span>
                                    <div>
                                      <span className={`text-xs font-bold block ${syncWithServer ? "text-sky-700 dark:text-sky-400" : "text-slate-500"}`}>
                                        Sincronizar Painel
                                      </span>
                                      <span className="text-[9px] text-slate-400 dark:text-white/40">
                                        {hasIntegration ? "Criar no servidor" : "Sem integração"}
                                      </span>
                                    </div>
                                  </div>
                                  <Switch checked={syncWithServer} onChange={(v) => hasIntegration && setSyncWithServer(v)} label="" />
                                </div>
                              )}

                              {/* Registrar Financeiro */}

                              <div 

                                onClick={() => {

                                  const next = !registerRenewal;

                                  setRegisterRenewal(next);

                                  setSendPaymentMsg(next);

                                }}

                                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${

                                  registerRenewal 

                                    ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20" 

                                    : "bg-slate-50 border-slate-200 dark:bg-white/5 dark:border-white/10"

                                }`}

                              >

                                <div className="flex items-center gap-2">

                                  <span className="text-lg">💰</span>

                                  <div>

                                    <span className={`text-xs font-bold block ${registerRenewal ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`}>

                                      Registrar Financeiro

                                    </span>

                                    <span className="text-[9px] text-slate-400 dark:text-white/40">

                                      Gera log de pagamento local

                                    </span>

                                  </div>

                                </div>

                                <Switch 

                                  checked={registerRenewal} 

                                  onChange={(v) => { 

                                    setRegisterRenewal(v);

                                    setSendPaymentMsg(v);

                                  }} 

                                  label="" 

                                />

                              </div>

                            </div>



                            {/* LINHA 2: WhatsApp */}

                            <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">

                              <div className={`grid grid-cols-1 ${sendPaymentMsg ? 'sm:grid-cols-2' : ''} gap-3 items-center`}>

                                <div

                                  onClick={() => setSendPaymentMsg(!sendPaymentMsg)}

                                  className="h-10 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center justify-between gap-3"

                                >

                                  <span className="text-xs font-bold text-slate-600 dark:text-white/70">

                                    Enviar msg pagto?

                                  </span>

                                  <Switch checked={sendPaymentMsg} onChange={setSendPaymentMsg} label="" />

                                </div>



                                {sendPaymentMsg && (

                                  <div className="animate-in fade-in zoom-in duration-200">

                                    <Select
                                      value={selectedTemplateId}
                                      onChange={(e) => {
                                        const id = e.target.value;
                                        setSelectedTemplateId(id);
                                        const tpl = templates.find((t) => t.id === id);
                                        setMessageContent(tpl?.content || "");
                                      }}
                                      className="h-10 w-full"
                                    >
                                      <option value="">-- Selecione um modelo --</option>
                                      {Object.entries(
                                        templates
                                          // 1. Esconde mensagens de Revendas
                                          .filter(t => t.category !== "Revenda IPTV" && t.category !== "Revenda SaaS")
                                          // 2. Agrupa por categoria
                                          .reduce((acc, t) => {
                                            const cat = t.category || "Geral";
                                            if (!acc[cat]) acc[cat] = [];
                                            acc[cat].push(t);
                                            return acc;
                                          }, {} as Record<string, typeof templates>)
                                      ).map(([catName, tmpls]) => (
                                        <optgroup key={catName} label={`— ${catName} —`}>
                                          {tmpls.map((t) => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                          ))}
                                        </optgroup>
                                      ))}
                                    </Select>

                                  </div>

                                )}

                              </div>

                            </div>

                          </div>

                        )}

                      </>

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

                    <div key={app.instanceId} className="px-3 pt-2 pb-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 relative group">

                      

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
                        <div className="mt-0 animate-in slide-in-from-top-2 duration-200">

                          {/* Configuração de Integração do App */}
                          {Boolean((catalog.find(c => c.id === app.app_id) as any)?.integration_type) && (
                              <div className="bg-transparent border-0 mb-0.5">
                              {!isEditing ? (
                                /* MODO CRIAÇÃO: Apenas o Toggle */
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <span className="text-xs font-bold text-slate-700 dark:text-white block">Configurar Aplicativo no Painel?</span>
                                    <span className="text-[10px] text-slate-500 dark:text-white/40">Automatizar criação ao salvar cliente</span>
                                  </div>
                                  <Switch
                                    checked={app.auto_configure ?? true}
                                    onChange={(v) => updateAppConfig(app.instanceId, "auto_configure", v)}
                                    label=""
                                  />
                                </div>
                              ) : (
                                /* MODO EDIÇÃO: Grid cravado em 2 colunas, sem flex-1 para não esmagar ninguem */
                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                      type="button"
                                      onClick={() => handleConfigApp(app.name)}
                                      className="h-10 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                  >
                                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                      </svg>
                                      <span className="hidden sm:inline">Configurar m3u</span>
                                      <span className="sm:hidden">Configurar</span>
                                  </button>
                                  <button
                                      type="button"
                                      onClick={async () => {
                                          // ✅ Usando a sua interface bonita!
                                          const ok = await confirmDeleteApp({
                                              title: "Remover do GerenciaApp?",
                                              subtitle: `Tem certeza que deseja excluir o acesso de ${username}?`,
                                              tone: "rose",
                                              confirmText: "Sim, remover",
                                              cancelText: "Cancelar"
                                          });
                                          if (ok) {
                                              await handleDeleteApp(app.name);
                                          }
                                      }}
                                      className="h-10 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                                  >
                                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                      <span className="hidden sm:inline">Remover m3u</span>
                                      <span className="sm:hidden">Remover</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}



                          {/* Campos do App */}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

                            {app.fields_config?.length > 0 ? (

  // ✅ Adicionamos o "index: number" aqui

  app.fields_config.map((field: any, index: number) => {

const fieldKey = String(field?.id ?? field?.label ?? "").trim(); // prioridade: id
  const rawLabel = String(field?.label ?? "").trim();
  // ✅ Tipo tem prioridade — ignora label legado do banco
  const label = APP_FIELD_LABELS[String(field?.type ?? "")] || rawLabel || "Campo";

  const isMacField = String(field?.type || "").toUpperCase() === "MAC";
  const isPasswordField = String(field?.type || "").toLowerCase() === "password";

  const safeKey = fieldKey || rawLabel || `${app.instanceId}-${index}`;

  const isDateField = field?.type === "date";
  const fieldValue = 
    (fieldKey && (app.values as any)?.[fieldKey] != null
      ? String((app.values as any)[fieldKey])
      : "") ||
    (label && (app.values as any)?.[label] != null
      ? String((app.values as any)[label])
      : "") ||
    "";

  const isVisible = visibleAppPasswords[safeKey] || false;
  const currentType = isDateField ? "date" : isPasswordField ? (isVisible ? "text" : "password") : "text";

  return (
    <div key={safeKey}>
      <Label>{label || "Campo"}</Label>

      <div className="relative">
        <FormattedDateInput
          type={currentType}
          value={fieldValue}
          onChange={(e) => {
            const raw = e.target.value;
            const next = isMacField ? normalizeMacInput(raw) : raw;

            const key = String(fieldKey || label || "").trim();
            if (!key) return;

            updateAppFieldValue(app.instanceId, key, next);
          }}
          placeholder={label ? `Digite ${label}...` : "Digite..."}
          autoCapitalize={isMacField ? "characters" : "none"}
          spellCheck={false}
          className={isPasswordField ? "pr-10" : ""} // Espaço para o ícone
        />

        {/* Botão do Olho (Só aparece se for campo de senha) */}
        {isPasswordField && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setVisibleAppPasswords(prev => ({ ...prev, [safeKey]: !prev[safeKey] }));
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:text-white/40 dark:hover:text-white/80 transition-colors"
            tabIndex={-1}
          >
            {isVisible ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );

})

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

          <div className="px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-2 rounded-b-xl shrink-0">

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

              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg disabled:opacity-75 disabled:cursor-not-allowed transition-all flex items-center gap-2"

            >

              {loading && (

                <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">

                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>

                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>

                </svg>

              )}

              {loading 

                ? loadingStep || "Processando..." 

                : isEditing 

                  ? "Salvar alterações" 

                  : (isTrialMode ? "Criar teste" : "Criar cliente")

              }

            </button>

          </div>

        </div>

      </div>



      {/* === MODAL DE CONFIRMAÇÃO (Padronizado) === */}
      {ConfirmUI} {/* ✅ Renderiza a caixa bonita sobre o modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-hidden overscroll-contain animate-in fade-in duration-200">

            <div

  className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-6 flex flex-col gap-5 overflow-hidden min-h-0 max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"

  style={{ maxHeight: "90dvh" }}

>

                

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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 4.98 0 11.111c0 3.508 1.777 6.64 4.622 8.67L3.333 24l4.444-2.222c1.333.37 2.592.556 4.223.556 6.627 0 12-4.98 12-11.111S18.627 0 12 0zm0 20c-1.37 0-2.703-.247-3.963-.733l-.283-.111-2.592 1.296.852-2.37-.37-.259C3.852 16.37 2.667 13.852 2.667 11.11 2.667 6.148 6.963 2.222 12 2.222c5.037 0 9.333 3.926 9.333 8.889S17.037 20 12 20zm5.037-6.63c-.278-.139-1.63-.815-1.889-.907-.259-.093-.445-.139-.63.139-.185.278-.722.907-.889 1.093-.167.185-.333.208-.611.069-.278-.139-1.167-.43-2.222-1.37-.822-.733-1.37-1.63-1.528-1.907-.157-.278-.017-.43.122-.569.126-.126.278-.333.417-.5.139-.167.185-.278.278-.463.093-.185.046-.347-.023-.486-.069-.139-.63-1.519-.863-2.083-.227-.546-.458-.472-.63-.48l-.54-.01c-.185 0-.486.069-.74.347-.254.278-.972.95-.972 2.315 0 1.365.996 2.685 1.135 2.87.139.185 1.96 2.997 4.87 4.207.681.294 1.213.47 1.628.602.684.217 1.306.187 1.797.113.548-.082 1.63-.667 1.86-1.31.23-.643.23-1.193.162-1.31-.069-.116-.254-.185-.532-.324z"/>
    </svg>
  );
}