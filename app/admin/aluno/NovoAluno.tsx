"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const LAST_MODALIDADE_KEY  = "unigestor_last_modalidade_aluno";
const LAST_TEMPLATE_KEY    = "unigestor_aluno_fav_template";

// Ordem alfabética — fácil de estender depois
const MODALIDADES = [
  "Artes Marciais Mistas",
  "Boxe",
  "Capoeira",
  "Crossfit",
  "Dança",
  "Futebol",
  "Funcional",
  "Ioga",
  "Jiu-Jitsu",
  "Judô",
  "Karatê",
  "Kickboxing",
  "Krav Magá",
  "Muay Thai",
  "Musculação",
  "Natação",
  "Personal Training",
  "Pilates",
  "Spinning",
  "Zumba",
  "Outras",
];

type CampoTipo = "text" | "date" | "number" | "select";
type CampoTemplate = { label: string; tipo: CampoTipo; opcoes?: string[] };

// Campos pré-definidos por modalidade — adicione novas entradas aqui quando precisar
const CAMPOS_POR_MODALIDADE: Record<string, CampoTemplate[]> = {
  "Jiu-Jitsu": [
    { label: "Faixa Atual", tipo: "select", opcoes: ["Branca","Cinza","Azul","Roxa","Marrom","Preta"] },
    { label: "Grau", tipo: "select", opcoes: ["0","1","2","3","4"] },
    { label: "Data da Última Promoção", tipo: "date" },
    { label: "Data da Próxima Promoção", tipo: "date" },
    { label: "Professor Responsável", tipo: "text" },
    { label: "Nº Registro na Federação", tipo: "text" },
  ],
  "Judô": [
    { label: "Faixa Atual", tipo: "select", opcoes: ["Branca","Amarela","Laranja","Verde","Azul","Marrom","Preta"] },
    { label: "Kyu / Dan", tipo: "text" },
    { label: "Data da Última Promoção", tipo: "date" },
    { label: "Professor Responsável", tipo: "text" },
    { label: "Nº Registro na Federação", tipo: "text" },
  ],
  "Karatê": [
    { label: "Faixa Atual", tipo: "select", opcoes: ["Branca","Amarela","Laranja","Verde","Azul","Marrom","Preta"] },
    { label: "Kyu / Dan", tipo: "text" },
    { label: "Professor Responsável", tipo: "text" },
    { label: "Nº Registro na Federação", tipo: "text" },
  ],
  "Musculação": [
    { label: "Divisão de Treino", tipo: "select", opcoes: ["Full Body","A/B","ABC","ABCD","ABCDE","Push/Pull/Legs"] },
    { label: "Personal Responsável", tipo: "text" },
    { label: "Ficha de Treino", tipo: "text" },
  ],
  "Natação": [
    { label: "Nível", tipo: "select", opcoes: ["Iniciante","Intermediário","Avançado","Competidor"] },
    { label: "Estilo Principal", tipo: "select", opcoes: ["Livre","Costas","Peito","Borboleta","Medley"] },
    { label: "Turma", tipo: "text" },
    { label: "Professor Responsável", tipo: "text" },
  ],
  "Personal Training": [
    { label: "Local do Treino", tipo: "select", opcoes: ["Academia","Domicílio","Parque","Online"] },
    { label: "Dias da Semana", tipo: "text" },
    { label: "Horário", tipo: "text" },
    { label: "Personal Responsável", tipo: "text" },
  ],
  "Boxe": [
    { label: "Nível", tipo: "select", opcoes: ["Iniciante","Intermediário","Avançado","Competidor"] },
    { label: "Professor Responsável", tipo: "text" },
    { label: "Peso (categoria)", tipo: "text" },
  ],
  "Muay Thai": [
    { label: "Nível", tipo: "select", opcoes: ["Iniciante","Intermediário","Avançado","Competidor"] },
    { label: "Professor Responsável", tipo: "text" },
    { label: "Nº Registro na Federação", tipo: "text" },
  ],
};

const OBJETIVOS = [
  { value: "ganhar_massa",    label: "Ganhar Massa Muscular"            },
  { value: "perder_peso",     label: "Perder Peso / Gordura"            },
  { value: "manter",          label: "Manter Peso"                      },
  { value: "condicionamento", label: "Condicionamento Físico"           },
  { value: "reabilitacao",    label: "Reabilitação"                     },
  { value: "competicao",      label: "Preparação para Competição"       },
  { value: "saude",           label: "Saúde e Qualidade de Vida"        },
  { value: "outro",           label: "Outro"                            },
];

const PLAN_LABELS: Record<string, string> = {
  MONTHLY:    "Mensal",
  BIMONTHLY:  "Bimestral",
  QUARTERLY:  "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL:     "Anual",
};

const PLAN_MONTHS: Record<string, number> = {
  MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12,
};

// ─── TIPOS ────────────────────────────────────────────────────────────────────

type Currency = "BRL" | "USD" | "EUR";

interface PlanTableItemPrice { screens_count: number; price_amount: number | null; }
interface PlanTableItem      { id: string; period: string; credits_base: number; prices: PlanTableItemPrice[]; }
interface PlanTable           { id: string; name: string; currency: Currency; is_system_default?: boolean; table_type?: string | null; items: PlanTableItem[]; }

type CampoPersonalizado = {
  id:     string;
  label:  string;
  value:  string;
  tipo:   CampoTipo;
  opcoes?: string[];
};

type AvaliacaoFisica = {
  id:             string;
  data:           string;
  peso_kg:        number | "";
  gordura_pct:    number | "";
  massa_magra_kg: number | "";
  cintura_cm:     number | "";
  quadril_cm:     number | "";
  braco_cm:       number | "";
  coxa_cm:        number | "";
  panturrilha_cm: number | "";
  abdomen_cm:     number | "";
  ombro_cm:       number | "";
  observacoes:    string;
};

type MessageTemplate = {
  id:        string;
  name:      string;
  content:   string;
  image_url?: string | null;
  category?:  string | null;
};

// Tipo compatível com o que a página /admin/aluno retorna
interface AlunoRow {
  id?:                       string;
  name?:                     string;
  whatsapp?:                 string;
  whatsapp_username?:        string;
  whatsapp_opt_in?:          boolean;
  secondary_display_name?:   string;
  secondary_phone_e164?:     string;
  secondary_whatsapp_username?: string;
  price_amount?:             number;
  price_currency?:           string;
  plan_name?:                string;
  vencimento?:               string;
  notes?:                    string;
  dados?:                    Record<string, any>;
}

interface Props {
  alunoToEdit?: AlunoRow | null;
  onClose:    () => void;
  onSuccess:  () => void;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0"); }

function generateUsername(fullName: string): string {
  const parts = fullName
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "";
  
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const first = cap(parts[0]);
  
  if (parts.length === 1) return first;
  
  const last = cap(parts[parts.length - 1]);
  const randomSuffix = Math.floor(100 + Math.random() * 900); // 3 dígitos para blindar contra duplicatas no BD
  return `${first}_${last}_${randomSuffix}`;
}

function getDefaultDueDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function calcIMC(altura_cm: number, peso_kg: number): number {
  if (!altura_cm || !peso_kg) return 0;
  const h = altura_cm / 100;
  return peso_kg / (h * h);
}

function getIMCInfo(imc: number): { label: string; color: string } {
  if (imc < 18.5) return { label: "Abaixo do peso",      color: "text-blue-500"   };
  if (imc < 25.0) return { label: "Peso normal",          color: "text-emerald-500"};
  if (imc < 30.0) return { label: "Sobrepeso",            color: "text-amber-500"  };
  if (imc < 35.0) return { label: "Obesidade I",          color: "text-orange-500" };
  if (imc < 40.0) return { label: "Obesidade II",         color: "text-rose-500"   };
  return              { label: "Obesidade III",         color: "text-rose-700"   };
}

function fmtMoney(currency: string, n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(n);
}

function safeNumber(s: string) {
  return Number(String(s || "0").replace(/\./g, "").replace(",", ".")) || 0;
}

function pickPrice(table: PlanTable | null, period: string, screens = 1): number {
  if (!table) return 0;
  const item  = table.items?.find(i => i.period === period);
  if (!item) return 0;
  const exact = item.prices?.find(p => p.screens_count === screens);
  if (exact?.price_amount != null) return Number(exact.price_amount);
  const one   = item.prices?.find(p => p.screens_count === 1);
  if (one?.price_amount != null) return Number(one.price_amount);
  return 0;
}

function onlyDigits(raw: string) {
  return raw.replace(/\D+/g, "");
}

const DDI_OPTIONS = [
  { code: "55", label: "Brasil", flag: "🇧🇷" },
  { code: "1", label: "EUA/Canadá", flag: "🇺🇸" },
  { code: "351", label: "Portugal", flag: "🇵🇹" },
  // (Pode adicionar os outros países aqui se quiser a lista completa depois)
];

function inferDDIFromDigits(allDigits: string, originalInput?: string): string {
  const digits = onlyDigits(allDigits || "");
  if (!digits) return "55";
  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) if (digits.startsWith(opt.code)) return opt.code;
  if (originalInput && originalInput.trim().startsWith("+")) return digits.slice(0, 3);
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
    if (rest.length >= 9) return `${area} ${rest.slice(0, 5)}-${rest.slice(5)}`.trim();
    if (rest.length >= 8) return `${area} ${rest.slice(0, 4)}-${rest.slice(4)}`.trim();
    return `${area} ${rest}`.trim();
  }
  return d;
}

function applyPhoneNormalization(rawInput: string) {
  const rawDigits = onlyDigits(rawInput);
  if (!rawDigits) return { countryLabel: "—", e164: "", nationalDigits: "", formattedNational: "" };
  const ddi = inferDDIFromDigits(rawDigits, rawInput);
  const meta = ddiMeta(ddi);
  const nationalDigits = rawDigits.startsWith(ddi) ? rawDigits.slice(ddi.length) : rawDigits;
  const formattedNational = formatNational(ddi, nationalDigits);
  const e164 = `+${ddi}${nationalDigits}`;
  return { countryLabel: meta.label, e164, nationalDigits, formattedNational };
}

function extractDdiFromLabel(label: string): string {
  const match = label.match(/\+(\d+)\)/);
  return match ? match[1] : "55";
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export default function NovoAluno({ alunoToEdit, onClose, onSuccess }: Props) {
  const isEditing   = !!alunoToEdit?.id;
  const [activeTab, setActiveTab] = useState<"dados" | "plano" | "saude">("dados");
  const [loading, setLoading]     = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [fetchingAux, setFetchingAux] = useState(true);

  // Toast
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const { confirm: confirmDialog, ConfirmUI } = useConfirm();

  function addToast(type: "success" | "error" | "warning", title: string, message?: string) {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, type, title, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  }

  // ─── TAB 1: DADOS ─────────────────────────────────────────────────────────

  const [salutation, setSalutation]       = useState("");
  const [name, setName]                   = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [cpfRg, setCpfRg]                 = useState("");
  const [primaryPhoneRaw, setPrimaryPhoneRaw] = useState("");
  const [primaryCountryLabel, setPrimaryCountryLabel] = useState<string>(ddiMeta("55").label);
  const [waUsername, setWaUsername]       = useState("");
  const [whatsUserTouched, setWhatsUserTouched] = useState(false);
  const [waOptIn, setWaOptIn]             = useState(true);

  type WaValidation = { loading: boolean; exists: boolean; jid?: string } | null;
  const [waValidation, setWaValidation] = useState<WaValidation>(null);
  const waValidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function handleDonePrimary() {
    const norm = applyPhoneNormalization(primaryPhoneRaw);
    setPrimaryCountryLabel(norm.countryLabel);
    setPrimaryPhoneRaw(norm.formattedNational || norm.nationalDigits || primaryPhoneRaw);
    const finalUser = whatsUserTouched ? waUsername : onlyDigits(norm.e164);
    if (!whatsUserTouched) setWaUsername(finalUser);
    void validateWa(finalUser, setWaValidation, setPrimaryCountryLabel);
  }
  const [createdAt, setCreatedAt]         = useState(() => {
    const n = new Date();
    n.setMinutes(n.getMinutes() - n.getTimezoneOffset());
    return n.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState("");

  // Contato de emergência
  const [showEmergency, setShowEmergency]           = useState(false);
  const [emergencySalut, setEmergencySalut]         = useState("");
  const [emergencyName, setEmergencyName]           = useState("");
  const [emergencyRelation, setEmergencyRelation]   = useState("");
  
  // Normalização do Telefone Secundário
  const [emergencyPhoneRaw, setEmergencyPhoneRaw]   = useState("");
  const [emergencyCountryLabel, setEmergencyCountryLabel] = useState<string>(ddiMeta("55").label);
  const [emergencyWa, setEmergencyWa]               = useState("");
  const [emergencyWhatsUserTouched, setEmergencyWhatsUserTouched] = useState(false);
  const [emergencyWaValidation, setEmergencyWaValidation] = useState<WaValidation>(null);
  const emergencyWaValidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleDoneEmergency() {
    const norm = applyPhoneNormalization(emergencyPhoneRaw);
    setEmergencyCountryLabel(norm.countryLabel);
    setEmergencyPhoneRaw(norm.formattedNational || norm.nationalDigits || emergencyPhoneRaw);
    const finalUser = emergencyWhatsUserTouched ? emergencyWa : onlyDigits(norm.e164);
    if (!emergencyWhatsUserTouched) setEmergencyWa(finalUser);
    void validateWa(finalUser, setEmergencyWaValidation, setEmergencyCountryLabel);
  }

  // Foto
  const [photoFile, setPhotoFile]     = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl]       = useState<string | null>(null);
  const photoRef                      = useRef<HTMLInputElement>(null);

  // WhatsApp session
  const [selectedSession, setSelectedSession] = useState("default");
  const [sessionOptions, setSessionOptions]   = useState<{ id: string; label: string }[]>([
    { id: "default",  label: "Sessão principal"   },
    { id: "session2", label: "Sessão secundária"  },
  ]);

  // ─── TAB 2: PLANO ─────────────────────────────────────────────────────────

  const savedModalidade = typeof window !== "undefined"
    ? localStorage.getItem(LAST_MODALIDADE_KEY) || "Musculação"
    : "Musculação";

  const [modalidade, setModalidade]           = useState(savedModalidade);
  const [campos, setCampos]                   = useState<CampoPersonalizado[]>([]);
  const [showAddCampo, setShowAddCampo]       = useState(false);
  const [novoCampoLabel, setNovoCampoLabel]   = useState("");
  const [novoCampoTipo, setNovoCampoTipo]     = useState<CampoTipo>("text");

  // Server / username
  const [servers, setServers]     = useState<{ id: string; name: string; slug: string }[]>([]);
  const [serverId, setServerId]   = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const autoUsername = useMemo(() => generateUsername(name), [name]);

  // Plan tables
  const [tables, setTables]               = useState<PlanTable[]>([]);
  const [tableId, setTableId]             = useState("");
  const selectedTable                     = useMemo(() => tables.find(t => t.id === tableId) || null, [tables, tableId]);
  const [period, setPeriod]               = useState("MONTHLY");
  const [planPrice, setPlanPrice]         = useState("0,00");
  const [priceTouched, setPriceTouched]   = useState(false);
  const [currency, setCurrency]           = useState<Currency>("BRL");
  const [dueDate, setDueDate]             = useState(getDefaultDueDate);

  // Financeiro
  const [registerFin, setRegisterFin]     = useState(true);
  const [sendMsg, setSendMsg]             = useState(true);
  const [templates, setTemplates]         = useState<MessageTemplate[]>([]);
  const [templateId, setTemplateId]       = useState(
    typeof window !== "undefined" ? localStorage.getItem(LAST_TEMPLATE_KEY) || "" : ""
  );
  const [msgContent, setMsgContent]       = useState("");

  // ─── TAB 3: SAÚDE ─────────────────────────────────────────────────────────

  const [altura, setAltura]           = useState<number | "">("");
  const [peso, setPeso]               = useState<number | "">("");
  const [objetivo, setObjetivo]       = useState("");
  const [historico, setHistorico]     = useState("");
  const [lesoes, setLesoes]           = useState("");
  const [fuma, setFuma]               = useState(false);
  const [bebe, setBebe]               = useState(false);
  const [doencas, setDoencas]         = useState("");
  const [atestadoFile, setAtestadoFile] = useState<File | null>(null);
  const [atestadoUrl, setAtestadoUrl] = useState<string | null>(null);
  const atestadoRef                   = useRef<HTMLInputElement>(null);
  const [avaliacoes, setAvaliacoes]   = useState<AvaliacaoFisica[]>([]);
  const [showNovaAv, setShowNovaAv]   = useState(false);
  const emptyAv = (): Omit<AvaliacaoFisica, "id"> => ({
    data: new Date().toISOString().slice(0, 10),
    peso_kg: "", gordura_pct: "", massa_magra_kg: "",
    cintura_cm: "", quadril_cm: "", braco_cm: "", coxa_cm: "",
    panturrilha_cm: "", abdomen_cm: "", ombro_cm: "", observacoes: "",
  });
  const [novaAv, setNovaAv] = useState(emptyAv);

  const imc     = useMemo(() => (altura && peso) ? calcIMC(Number(altura), Number(peso)) : 0, [altura, peso]);
  const imcInfo = useMemo(() => imc > 0 ? getIMCInfo(imc) : null, [imc]);

  // ─── SCROLL LOCK ──────────────────────────────────────────────────────────

  const scrollYRef = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const y = window.scrollY;
    scrollYRef.current = y;
    const b = document.body;
    b.style.overflow  = "hidden";
    b.style.position  = "fixed";
    b.style.top       = `-${y}px`;
    b.style.width     = "100%";
    return () => {
      b.style.overflow = "";
      b.style.position = "";
      b.style.top      = "";
      b.style.width    = "";
      window.scrollTo(0, scrollYRef.current);
    };
  }, []);

  // ─── PRICE AUTO-CALC ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedTable) return;
    setCurrency(selectedTable.currency || "BRL");
  }, [tableId, selectedTable]);

  useEffect(() => {
    if (priceTouched) return;
    const p = pickPrice(selectedTable, period);
    setPlanPrice(Number(p || 0).toFixed(2).replace(".", ","));
  }, [selectedTable, period, priceTouched]);

  // ─── CAMPOS POR MODALIDADE ────────────────────────────────────────────────

  useEffect(() => {
    if (isEditing) return; // não sobrescreve campos ao editar
    const tpl = CAMPOS_POR_MODALIDADE[modalidade] || [];
    setCampos(tpl.map(c => ({ id: crypto.randomUUID(), label: c.label, value: "", tipo: c.tipo, opcoes: c.opcoes })));
    if (typeof window !== "undefined") localStorage.setItem(LAST_MODALIDADE_KEY, modalidade);
  }, [modalidade, isEditing]);

  // ─── LOAD AUX ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const tid = await getCurrentTenantId();
        if (!alive) return;

        // Tenant slug
        const { data: tenant } = await supabaseBrowser
          .from("tenants").select("slug").eq("id", tid).maybeSingle();
        if (alive && tenant?.slug) setTenantSlug(tenant.slug);

        // Servers
        const { data: srvs } = await supabaseBrowser
          .from("servers").select("id, name, slug")
          .eq("tenant_id", tid).eq("is_archived", false);
        if (alive && srvs?.length) {
          setServers(srvs);
          const match = srvs.find(
            s => s.slug?.toLowerCase() === tenant?.slug?.toLowerCase()
              || s.name?.toLowerCase() === tenant?.slug?.toLowerCase()
          ) || srvs[0];
          if (match) setServerId(match.id);
        }

        // Plan tables (load all active)
        const { data: tRes } = await supabaseBrowser
          .from("plan_tables")
          .select(`id, name, currency, is_system_default, table_type,
            items:plan_table_items(id, period, credits_base,
              prices:plan_table_item_prices(screens_count, price_amount))`)
          .eq("tenant_id", tid).eq("is_active", true);
        if (alive && tRes) {
          const all = tRes as unknown as PlanTable[];
          setTables(all);
          const def = all.find(t => t.currency === "BRL" && t.is_system_default)
            || all.find(t => t.currency === "BRL") || all[0];
          if (def) { setTableId(def.id); setCurrency(def.currency || "BRL"); }
        }

        // Templates
        const { data: tmpl } = await supabaseBrowser
          .from("message_templates").select("id, name, content, image_url, category")
          .eq("tenant_id", tid).order("name");
        if (alive && tmpl) {
          setTemplates(tmpl as MessageTemplate[]);
          const saved = typeof window !== "undefined" ? localStorage.getItem(LAST_TEMPLATE_KEY) : null;
          const def = (saved && (tmpl as MessageTemplate[]).find(t => t.id === saved))
            || (tmpl as MessageTemplate[]).find(t => t.name === "Pagamento Realizado")
            || tmpl[0];
          if (def) { setTemplateId(def.id); setMsgContent((def as any).content || ""); }
        }

        // WhatsApp sessions
        try {
          const [r1, r2] = await Promise.all([
            fetch("/api/whatsapp/profile",  { cache: "no-store" }).then(r => r.json()).catch(() => ({})),
            fetch("/api/whatsapp/profile2", { cache: "no-store" }).then(r => r.json()).catch(() => ({})),
          ]);
          const n1 = (typeof window !== "undefined" && localStorage.getItem("wa_label_1")) || "Principal";
          const n2 = (typeof window !== "undefined" && localStorage.getItem("wa_label_2")) || "Secundária";
          if (alive) setSessionOptions([
            { id: "default",  label: r1?.connected ? `${n1} (conectado)` : `${n1} (desconectado)` },
            { id: "session2", label: r2?.connected ? `${n2} (conectado)` : `${n2} (desconectado)` },
          ]);
        } catch {}

        // ── PREFILL EDIÇÃO ────────────────────────────────────────────────
        if (isEditing && alunoToEdit) {
          setName(alunoToEdit.name || "");
          if (alunoToEdit.whatsapp) {
            const digits = onlyDigits(alunoToEdit.whatsapp);
            const ddi = inferDDIFromDigits(digits, alunoToEdit.whatsapp);
            const national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
            setPrimaryCountryLabel(ddiMeta(ddi).label);
            setPrimaryPhoneRaw(formatNational(ddi, national) || national);
          }
          setWaUsername(alunoToEdit.whatsapp_username || "");
          setWaOptIn(alunoToEdit.whatsapp_opt_in ?? true);
          setNotes(alunoToEdit.notes || "");

          if (alunoToEdit.secondary_display_name) {
            setShowEmergency(true);
            setEmergencyName(alunoToEdit.secondary_display_name);
            setEmergencyWa(alunoToEdit.secondary_whatsapp_username || "");
            if (alunoToEdit.secondary_phone_e164) {
              const digits = onlyDigits(alunoToEdit.secondary_phone_e164);
              const ddi = inferDDIFromDigits(digits, alunoToEdit.secondary_phone_e164);
              const national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
              setEmergencyCountryLabel(ddiMeta(ddi).label);
              setEmergencyPhoneRaw(formatNational(ddi, national) || national);
            }
          }

          if (alunoToEdit.price_amount) {
            setPlanPrice(Number(alunoToEdit.price_amount).toFixed(2).replace(".", ","));
            setPriceTouched(true);
          }

          if (alunoToEdit.vencimento) {
            const dt = new Date(alunoToEdit.vencimento);
            setDueDate(`${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`);
          }

          const dados = alunoToEdit.dados || {};

          if (dados.modalidade) setModalidade(dados.modalidade);
          if (dados.campos_detalhamento?.length) setCampos(dados.campos_detalhamento);
          if (dados.foto_url)        { setPhotoUrl(dados.foto_url); setPhotoPreview(dados.foto_url); }
          if (dados.data_nascimento) setDataNascimento(dados.data_nascimento);
          if (dados.cpf_rg)          setCpfRg(dados.cpf_rg);
          if (dados.contato_emergencia_parentesco) setEmergencyRelation(dados.contato_emergencia_parentesco);

          const s = dados.saude || {};
          if (s.altura_cm)       setAltura(s.altura_cm);
          if (s.peso_kg)         setPeso(s.peso_kg);
          if (s.objetivo)        setObjetivo(s.objetivo);
          if (s.historico_medico) setHistorico(s.historico_medico);
          if (s.lesoes)          setLesoes(s.lesoes);
          if (s.fuma != null)    setFuma(s.fuma);
          if (s.bebe != null)    setBebe(s.bebe);
          if (s.doencas_cronicas) setDoencas(s.doencas_cronicas);
          if (s.atestado_url)    setAtestadoUrl(s.atestado_url);
          if (s.avaliacoes?.length) setAvaliacoes(s.avaliacoes);
        }

      } catch (e) {
        console.error("Falha ao carregar dados:", e);
      } finally {
        if (alive) setFetchingAux(false);
      }
    }
    load();
    return () => { alive = false; };
  }, []); // eslint-disable-line

  // ─── PHOTO ────────────────────────────────────────────────────────────────

  async function uploadPhoto(clientId: string): Promise<string | null> {
    if (!photoFile) return photoUrl;
    try {
      const tid = await getCurrentTenantId();
      const ext  = photoFile.name.split(".").pop() || "jpg";
      const path = `${tid}/alunos/${clientId}/foto.${ext}`;
      const { error } = await supabaseBrowser.storage
        .from("chat_media").upload(path, photoFile, { contentType: photoFile.type, upsert: true });
      if (error) throw error;
      const { data } = supabaseBrowser.storage.from("chat_media").getPublicUrl(path);
      return data.publicUrl;
    } catch (e) { console.error("Upload foto:", e); return null; }
  }

  async function uploadAtestado(clientId: string): Promise<string | null> {
    if (!atestadoFile) return atestadoUrl;
    try {
      const tid  = await getCurrentTenantId();
      const ext  = atestadoFile.name.split(".").pop() || "pdf";
      const path = `${tid}/alunos/${clientId}/atestado.${ext}`;
      const { error } = await supabaseBrowser.storage
        .from("chat_media").upload(path, atestadoFile, { contentType: atestadoFile.type, upsert: true });
      if (error) throw error;
      const { data } = supabaseBrowser.storage.from("chat_media").getPublicUrl(path);
      return data.publicUrl;
    } catch (e) { console.error("Upload atestado:", e); return null; }
  }

  // ─── CAMPOS DETALHAMENTO ──────────────────────────────────────────────────

  function addCampo() {
    if (!novoCampoLabel.trim()) return;
    setCampos(p => [...p, { id: crypto.randomUUID(), label: novoCampoLabel.trim(), value: "", tipo: novoCampoTipo }]);
    setNovoCampoLabel(""); setShowAddCampo(false);
  }

  function updateCampo(id: string, value: string) {
    setCampos(p => p.map(c => c.id === id ? { ...c, value } : c));
  }

  // ─── AVALIAÇÕES ───────────────────────────────────────────────────────────

  function addAvaliacao() {
    setAvaliacoes(p => [...p, { ...novaAv, id: crypto.randomUUID() }]);
    setShowNovaAv(false);
    setNovaAv(emptyAv());
  }

  // ─── PDF AVALIAÇÃO ────────────────────────────────────────────────────────
  function gerarPDFAvaliacao(av: AvaliacaoFisica) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    // Calcula IMC para o Relatório, assim como faz no front
    const pesoN = Number(av.peso_kg || 0);
    const alturaM = Number(altura || 0) / 100;
    const imcCard = (pesoN > 0 && alturaM > 0) ? (pesoN / (alturaM * alturaM)).toFixed(1) : '--';

    const html = `
      <html>
        <head>
          <title>Avaliação Física - ${name || 'Aluno'}</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>@media print { @page { margin: 10mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }</style>
        </head>
        <body class="p-8 text-slate-800 font-sans bg-white">
          <div class="max-w-4xl mx-auto border-2 border-slate-100 p-8 rounded-3xl shadow-sm">
            
            <div class="flex items-center justify-between border-b-[3px] border-emerald-500 pb-6 mb-8">
              <div class="flex items-center gap-6">
                ${photoPreview 
                  ? `<img src="${photoPreview}" class="w-24 h-24 rounded-2xl object-cover border-4 border-emerald-50 shadow-md" />` 
                  : `<div class="w-24 h-24 rounded-2xl bg-slate-100 flex items-center justify-center text-4xl shadow-inner">👤</div>`
                }
                <div>
                  <h1 class="text-4xl font-black text-slate-800 uppercase tracking-tight">${name || 'Aluno'}</h1>
                  <p class="text-lg text-slate-500 font-medium mt-1">Avaliação Bioimpedância • ${new Date(av.data + "T12:00:00").toLocaleDateString("pt-BR")}</p>
                </div>
              </div>
              <div class="text-right">
                <h2 class="text-2xl font-black text-emerald-600 tracking-tighter">UniGestor</h2>
                <p class="text-sm text-slate-400 font-bold uppercase tracking-widest mt-1">Saúde & Performance</p>
              </div>
            </div>

            <div class="grid grid-cols-4 gap-6 mb-10">
              <div class="bg-slate-50 p-5 rounded-2xl border border-slate-100 flex flex-col items-center justify-center">
                <p class="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">Peso Total</p>
                <p class="text-3xl font-black text-slate-700">${av.peso_kg || '--'}<span class="text-sm font-bold text-slate-400 ml-1">kg</span></p>
              </div>
              <div class="bg-rose-50 p-5 rounded-2xl border border-rose-100 flex flex-col items-center justify-center">
                <p class="text-xs text-rose-400 font-bold uppercase tracking-wider mb-2">Gordura Corporal</p>
                <p class="text-3xl font-black text-rose-600">${av.gordura_pct || '--'}<span class="text-sm font-bold text-rose-400 ml-1">%</span></p>
              </div>
              <div class="bg-emerald-50 p-5 rounded-2xl border border-emerald-100 flex flex-col items-center justify-center">
                <p class="text-xs text-emerald-500 font-bold uppercase tracking-wider mb-2">Massa Magra</p>
                <p class="text-3xl font-black text-emerald-600">${av.massa_magra_kg || '--'}<span class="text-sm font-bold text-emerald-500 ml-1">kg</span></p>
              </div>
              <div class="bg-indigo-50 p-5 rounded-2xl border border-indigo-100 flex flex-col items-center justify-center">
                <p class="text-xs text-indigo-400 font-bold uppercase tracking-wider mb-2">IMC Físico</p>
                <p class="text-3xl font-black text-indigo-600">${imcCard}</p>
              </div>
            </div>

            <h3 class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 border-b border-slate-100 pb-2">Perimetria (Medidas Corporais)</h3>
            <div class="grid grid-cols-4 gap-4 mb-10">
              <div class="p-4 bg-white border-2 border-slate-100 rounded-xl text-center"><span class="block text-[10px] uppercase font-bold text-slate-400 mb-1">Cintura</span><span class="font-black text-xl text-slate-700">${av.cintura_cm || '--'} <span class="text-[10px] font-medium text-slate-400">cm</span></span></div>
              <div class="p-4 bg-white border-2 border-slate-100 rounded-xl text-center"><span class="block text-[10px] uppercase font-bold text-slate-400 mb-1">Quadril</span><span class="font-black text-xl text-slate-700">${av.quadril_cm || '--'} <span class="text-[10px] font-medium text-slate-400">cm</span></span></div>
              <div class="p-4 bg-white border-2 border-slate-100 rounded-xl text-center"><span class="block text-[10px] uppercase font-bold text-slate-400 mb-1">Braço</span><span class="font-black text-xl text-slate-700">${av.braco_cm || '--'} <span class="text-[10px] font-medium text-slate-400">cm</span></span></div>
              <div class="p-4 bg-white border-2 border-slate-100 rounded-xl text-center"><span class="block text-[10px] uppercase font-bold text-slate-400 mb-1">Coxa</span><span class="font-black text-xl text-slate-700">${av.coxa_cm || '--'} <span class="text-[10px] font-medium text-slate-400">cm</span></span></div>
              <div class="p-4 bg-white border-2 border-slate-100 rounded-xl text-center"><span class="block text-[10px] uppercase font-bold text-slate-400 mb-1">Panturrilha</span><span class="font-black text-xl text-slate-700">${av.panturrilha_cm || '--'} <span class="text-[10px] font-medium text-slate-400">cm</span></span></div>
              <div class="p-4 bg-white border-2 border-slate-100 rounded-xl text-center"><span class="block text-[10px] uppercase font-bold text-slate-400 mb-1">Abdômen</span><span class="font-black text-xl text-slate-700">${av.abdomen_cm || '--'} <span class="text-[10px] font-medium text-slate-400">cm</span></span></div>
              <div class="p-4 bg-white border-2 border-slate-100 rounded-xl text-center"><span class="block text-[10px] uppercase font-bold text-slate-400 mb-1">Ombro</span><span class="font-black text-xl text-slate-700">${av.ombro_cm || '--'} <span class="text-[10px] font-medium text-slate-400">cm</span></span></div>
            </div>

            ${av.observacoes ? `
            <h3 class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3 border-b border-slate-100 pb-2">Diagnóstico / Observações</h3>
            <p class="text-sm text-slate-600 bg-slate-50 p-6 rounded-2xl font-medium leading-relaxed border border-slate-100">${av.observacoes.replace(/\n/g, '<br/>')}</p>
            ` : ''}
            
            <div class="mt-16 text-center text-slate-300 text-[10px] font-bold uppercase tracking-widest">
              Documento gerado e autenticado por UniGestor
            </div>
          </div>
          <script>
            window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 500); }
          </script>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  }

  // ─── SAVE ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!name.trim()) { addToast("error", "Nome obrigatório", "Informe o nome do aluno."); return; }
    if (!serverId)    { addToast("error", "Servidor necessário", "Nenhum servidor encontrado. Crie um servidor antes de cadastrar alunos."); return; }

    setLoading(true); setLoadingStep("Salvando aluno...");

    try {
      const tid = await getCurrentTenantId();
      const { data: userRes } = await supabaseBrowser.auth.getUser();
      const createdBy = userRes?.user?.id;

      const finalUsername    = autoUsername || "aluno";
      const rawPrimaryDigits = onlyDigits(primaryPhoneRaw);
      const primaryDdi = rawPrimaryDigits ? extractDdiFromLabel(primaryCountryLabel) : "55";
      const primaryNat = rawPrimaryDigits.startsWith(primaryDdi) ? rawPrimaryDigits.slice(primaryDdi.length) : rawPrimaryDigits;
      const finalPhone = rawPrimaryDigits ? `+${primaryDdi}${primaryNat}` : null;
      const rawEmergDigits = onlyDigits(emergencyPhoneRaw);
      const emergDdi = rawEmergDigits ? extractDdiFromLabel(emergencyCountryLabel) : "55";
      const emergNat = rawEmergDigits.startsWith(emergDdi) ? rawEmergDigits.slice(emergDdi.length) : rawEmergDigits;
      const finalEmergPhone = rawEmergDigits ? `+${emergDdi}${emergNat}` : null;
      const dueISO           = new Date(`${dueDate}T23:59:00`).toISOString();
      const finalPrice       = safeNumber(planPrice);
      const planLabel        = PLAN_LABELS[period] || "Mensal";

      let clientId = alunoToEdit?.id;

      const sharedParams = {
        p_display_name:             name.trim(),
        p_server_id:                serverId,
        p_server_username:          finalUsername,
        p_server_password:          "",
        p_screens:                  1,
        p_plan_label:               planLabel,
        p_plan_table_id:            tableId || null,
        p_price_amount:             finalPrice,
        p_price_currency:           currency as any,
        p_vencimento:               dueISO,
        p_phone_e164:               finalPhone,
        p_whatsapp_username:        waUsername || null,
        p_whatsapp_opt_in:          waOptIn,
        p_whatsapp_snooze_until:    null,
        p_clear_whatsapp_snooze_until: true,
        p_name_prefix:              salutation || null,
        p_technology:               modalidade,       // reutiliza campo technology para modalidade
        p_secondary_display_name:   emergencyName.trim() || null,
        p_secondary_name_prefix:    emergencySalut || null,
        p_secondary_phone_e164:     finalEmergPhone,
        p_secondary_whatsapp_username: emergencyWa || null,
      };

      if (isEditing && clientId) {
        const { error } = await supabaseBrowser.rpc("update_client", {
          p_tenant_id:  tid,
          p_client_id:  clientId,
          ...sharedParams,
          p_notes:      notes?.trim() || null,
          p_clear_notes: !notes?.trim(),
          p_is_trial:   false,
          p_clear_secondary: !emergencyName.trim() && !finalEmergPhone,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabaseBrowser.rpc("create_client_and_setup", {
          p_tenant_id:  tid,
          p_created_by: createdBy,
          ...sharedParams,
          p_notes:      notes?.trim() || null,
          p_app_ids:    [],
          p_is_trial:   false,
          p_is_archived: false,
        });
        if (error) throw error;
        clientId = data;
      }

      // Upload foto
      let finalPhotoUrl = photoUrl;
      if (photoFile && clientId) {
        setLoadingStep("Enviando foto...");
        finalPhotoUrl = await uploadPhoto(clientId);
      }

      // Upload atestado
      let finalAtestadoUrl = atestadoUrl;
      if (atestadoFile && clientId) {
        setLoadingStep("Enviando atestado...");
        finalAtestadoUrl = await uploadAtestado(clientId);
      }

      // PATCH dados_extras + tipo_cadastro + created_at
      setLoadingStep("Salvando dados extras...");
      const dadosExtras = {
        tipo:             "aluno",
        modalidade,
        campos_detalhamento: campos,
        foto_url:         finalPhotoUrl || null,
        data_nascimento:  dataNascimento || null,
        cpf_rg:           cpfRg || null,
        contato_emergencia_parentesco: emergencyRelation || null,
        saude: {
          altura_cm:       altura || null,
          peso_kg:         peso   || null,
          imc:             imc > 0 ? parseFloat(imc.toFixed(2)) : null,
          objetivo:        objetivo || null,
          historico_medico: historico || null,
          lesoes:          lesoes || null,
          fuma,
          bebe,
          doencas_cronicas: doencas || null,
          atestado_url:    finalAtestadoUrl || null,
          avaliacoes,
        },
      };

      if (clientId) {
        const patch: Record<string, any> = {
          dados_extras:  dadosExtras,
          tipo_cadastro: "academia",
        };
        // Atualiza data de cadastro se preenchida
        if (createdAt) {
          const parsedCA = new Date(createdAt + ":00").toISOString();
          if (!isNaN(new Date(parsedCA).getTime())) patch.created_at = parsedCA;
        }
        await supabaseBrowser.from("clients")
          .update(patch).eq("id", clientId).eq("tenant_id", tid);
      }

      // Registro financeiro (somente criação)
      if (registerFin && clientId && !isEditing) {
        setLoadingStep("Registrando financeiro...");
        const months = PLAN_MONTHS[period] || 1;
        await supabaseBrowser.rpc("renew_client_and_log", {
          p_tenant_id:     tid,
          p_client_id:     clientId,
          p_months:        months,
          p_status:        "PAID",
          p_notes:         notes || null,
          p_new_vencimento: dueISO,
          p_message:       `Matrícula registrada · ${planLabel} · ${fmtMoney(currency, finalPrice)}`,
          p_unit_price:    parseFloat((finalPrice / months).toFixed(2)),
          p_total_amount:  finalPrice,
        });
      }

      // Mensagem WhatsApp (somente criação)
      if (sendMsg && msgContent?.trim() && clientId && !isEditing) {
        setLoadingStep("Enviando mensagem...");
        try {
          const { data: sess } = await supabaseBrowser.auth.getSession();
          const token = sess?.session?.access_token;
          await fetch("/api/whatsapp/envio_agora", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              tenant_id: tid,
              client_id: clientId,
              message:   msgContent,
              message_template_id: templateId || null,
              whatsapp_session:    selectedSession,
            }),
          });
        } catch (e) { console.error("WhatsApp falhou:", e); }
      }

      // Salva preferências
      if (typeof window !== "undefined") {
        localStorage.setItem(LAST_MODALIDADE_KEY, modalidade);
        if (templateId) localStorage.setItem(LAST_TEMPLATE_KEY, templateId);
      }

      // Toast na lista
      try {
        const key = "alunos_list_toasts";
        const arr = JSON.parse(window.sessionStorage.getItem(key) || "[]");
        arr.push({ type: "success", title: isEditing ? "Aluno atualizado" : "Aluno cadastrado", ts: Date.now() });
        window.sessionStorage.setItem(key, JSON.stringify(arr));
      } catch {}

      setTimeout(() => { onSuccess(); onClose(); }, 600);

    } catch (err: any) {
      console.error("Erro ao salvar aluno:", err);
      addToast("error", "Erro ao salvar", err?.message || "Erro desconhecido.");
    } finally {
      setLoading(false); setLoadingStep("");
    }
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  if (fetchingAux) return null;

  const tenantDisplay = tenantSlug
    ? tenantSlug.charAt(0).toUpperCase() + tenantSlug.slice(1).toLowerCase()
    : "—";

  return (
    <>
      <div className="fixed inset-x-0 top-2 z-[999999] px-3 pointer-events-none">
        <div className="pointer-events-auto">
          <ToastNotifications toasts={toasts} removeToast={id => setToasts(p => p.filter(t => t.id !== id))} />
        </div>
      </div>

      <div
        className="fixed inset-0 z-[99990] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="w-full max-w-lg sm:max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[90dvh]"
          onPointerDown={e => e.stopPropagation()}
        >
          {/* HEADER */}
          <div className="relative px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-center items-center bg-slate-50 dark:bg-white/5 rounded-t-xl shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-lg">🏋️‍♂️</div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white">
                {isEditing ? `Editar: ${alunoToEdit?.name}` : "Novo Aluno"}
              </h2>
            </div>
            <button onClick={onClose} type="button" className="absolute right-4 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 transition-colors">
              <IconX />
            </button>
          </div>

          {/* ABAS */}
          <div className="flex justify-center border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 px-4 py-2 shrink-0">
            <div className="flex bg-slate-200/50 dark:bg-black/20 rounded-lg p-1 w-full sm:w-auto">
              {([
                { key: "dados" as const,  label: "DADOS"  },
                { key: "plano" as const,  label: "PLANO"  },
                { key: "saude" as const,  label: "SAÚDE"  },
              ]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 sm:flex-none px-6 py-2 text-xs font-bold rounded-md transition-all uppercase tracking-wider ${
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
            className="p-3 sm:p-4 overflow-y-auto space-y-3 flex-1 min-h-0 bg-white dark:bg-[#161b22]"
            style={{ WebkitOverflowScrolling: "touch" }}
          >

            {/* ══════════════════════════ TAB: DADOS ══════════════════════════ */}
            {activeTab === "dados" && (
              <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">

                {/* Foto + Nome + Nascimento + Documento Centralizados em Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4">
                  {/* FOTO - Ocupa a coluna da esquerda com as duas linhas no Desktop */}
                  <div className="flex justify-center sm:row-span-2 sm:pt-4">
                    <div className="flex-shrink-0 flex flex-col items-center gap-1 w-24">
                      <FL>Foto</FL>
                      {photoPreview ? (
                        <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-emerald-500/40 shadow-sm">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photoPreview} alt="Foto" className="w-full h-full object-cover" />
                          <button
                            onClick={() => { setPhotoFile(null); setPhotoPreview(null); setPhotoUrl(null); if (photoRef.current) photoRef.current.value = ""; }}
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 shadow-md"
                            title="Remover"
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => photoRef.current?.click()}
                          className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 dark:border-white/20 flex flex-col items-center justify-center gap-1 text-slate-400 hover:border-emerald-500/50 hover:text-emerald-600 transition-all bg-slate-50 dark:bg-black/20"
                        >
                          <IconCamera />
                          <span className="text-[9px] font-bold">Foto</span>
                        </button>
                      )}
                      <button onClick={() => photoRef.current?.click()} className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold hover:underline">
                        {photoPreview ? "Trocar" : "Carregar"}
                      </button>
                      <input ref={photoRef} type="file" accept="image/*" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) { setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)); } }} />
                    </div>
                  </div>

                  {/* Lado Direito: Linha 1 (Nome) e Linha 2 (Nascimento/Doc) */}
                  <div className="flex flex-col gap-3">
                    {/* Saudação + Nome */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="col-span-1">
                        <FL>Saudação</FL>
                        <FS value={salutation} onChange={e => setSalutation(e.target.value)}>
                          <option value=""> </option>
                          <option>Sr.</option><option>Sra.</option>
                          <option>Dr.</option><option>Dra.</option>
                        </FS>
                      </div>
                      <div className="col-span-3">
                        <FL>Nome do Aluno *</FL>
                        <FI value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Nome completo" />
                      </div>
                    </div>
                    {/* Nascimento + CPF/RG (Agora imediatamente abaixo do nome) */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <FL>Data de Nascimento</FL>
                        <FI type="date" value={dataNascimento} onChange={e => setDataNascimento(e.target.value)} className="dark:[color-scheme:dark]" />
                      </div>
                      <div>
                        <FL>CPF / RG</FL>
                        <FI value={cpfRg} onChange={e => setCpfRg(e.target.value)} placeholder="000.000.000-00" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Telefone + WhatsApp (Formato Novo Cliente) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PhoneRow
                    label="Telefone / WhatsApp"
                    countryLabel={primaryCountryLabel}
                    rawValue={primaryPhoneRaw}
                    onRawChange={setPrimaryPhoneRaw}
                    onDone={handleDonePrimary}
                  />
                  <div>
                    <FL>Username WhatsApp</FL>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
                      <FI 
                        className="pl-8 pr-10" 
                        value={waUsername} 
                        onChange={(e) => {
                          const val = e.target.value;
                          setWaUsername(val);
                          setWhatsUserTouched(true);
                          setWaValidation(null);
                          if (waValidateTimer.current) clearTimeout(waValidateTimer.current);
                          waValidateTimer.current = setTimeout(() => {
                            void validateWa(val, setWaValidation, setPrimaryCountryLabel);
                          }, 800);
                        }} 
                        placeholder="username" 
                      />
                      {waUsername && (
                        <a href={`https://wa.me/${waUsername}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 hover:text-emerald-600" title="Abrir conversa">
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

                {/* Contato de Emergência */}
                {!showEmergency ? (
                  <div className="flex justify-end border-t border-slate-100 dark:border-white/5 pt-3">
                    <button
                      type="button"
                      onClick={() => setShowEmergency(true)}
                      className="text-[10px] px-2 py-0.5 bg-amber-500/10 rounded text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                    >
                      🆘 + CONTATO DE EMERGÊNCIA
                    </button>
                  </div>
                ) : (
                  <div className="border-t border-slate-200 dark:border-white/10 pt-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">🆘 Contato de Emergência</h3>
                      <button
                        type="button"
                        onClick={() => { setShowEmergency(false); setEmergencyName(""); setEmergencyPhoneRaw(""); setEmergencyWa(""); setEmergencyRelation(""); }}
                        className="text-[10px] text-rose-500 font-bold hover:bg-rose-500/10 px-2 py-0.5 rounded"
                      >
                        REMOVER
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="col-span-1">
                        <FL>Saudação</FL>
                        <FS value={emergencySalut} onChange={e => setEmergencySalut(e.target.value)}>
                          <option value=""> </option>
                          <option>Sr.</option><option>Sra.</option>
                        </FS>
                      </div>
                      <div className="col-span-3">
                        <FL>Nome</FL>
                        <FI value={emergencyName} onChange={e => setEmergencyName(e.target.value)} placeholder="Nome completo" />
                      </div>
                    </div>
                    {/* Linha tripla no Desktop (Parentesco / Tel / Whats) */}
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_1.5fr] gap-3 items-start">
                      <div>
                        <FL>Parentesco</FL>
                        <FI value={emergencyRelation} onChange={e => setEmergencyRelation(e.target.value)} placeholder="Ex: Pai" />
                      </div>
                      
                      <PhoneRow
                        label="Telefone Secundário"
                        countryLabel={emergencyCountryLabel}
                        rawValue={emergencyPhoneRaw}
                        onRawChange={setEmergencyPhoneRaw}
                        onDone={handleDoneEmergency}
                      />
                      
                      <div>
                        <FL>WhatsApp Username</FL>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
                          <FI 
                            className="pl-8 pr-10" 
                            value={emergencyWa} 
                            onChange={(e) => {
                              const val = e.target.value;
                              setEmergencyWa(val);
                              setEmergencyWhatsUserTouched(true);
                              setEmergencyWaValidation(null);
                              if (emergencyWaValidateTimer.current) clearTimeout(emergencyWaValidateTimer.current);
                              emergencyWaValidateTimer.current = setTimeout(() => {
                                void validateWa(val, setEmergencyWaValidation, setEmergencyCountryLabel);
                              }, 800);
                            }} 
                            placeholder="username" 
                          />
                        </div>
                        {emergencyWaValidation && (
                          <div className={`mt-1 flex items-center gap-1.5 text-[11px] font-bold ${emergencyWaValidation.loading ? "text-slate-400" : emergencyWaValidation.exists ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
                            {emergencyWaValidation.loading ? (
                              <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Validando...</>
                            ) : emergencyWaValidation.exists ? (
                              <>✅ Ativo</>
                            ) : (
                              <>❌ Não existe</>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Data, Opt-in, Sessão */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-100 dark:border-white/5 pt-3">
                  <div>
                    <FL>Data Cadastro</FL>
                    <FI type="datetime-local" value={createdAt} onChange={e => setCreatedAt(e.target.value)} className="dark:[color-scheme:dark] text-xs" />
                  </div>
                  <div className="flex items-end">
                    <div
                      className="h-10 w-full px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg flex items-center justify-between gap-3 cursor-pointer"
                      onClick={() => setWaOptIn(v => !v)}
                    >
                      <span className="text-xs text-slate-600 dark:text-white/70">Aceita mensagem?</span>
                      <Switch checked={waOptIn} onChange={setWaOptIn} label="" />
                    </div>
                  </div>
                  <div>
                    <FL>Sessão WhatsApp</FL>
                    <FS value={selectedSession} onChange={e => setSelectedSession(e.target.value)}>
                      {sessionOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </FS>
                  </div>
                </div>

                {/* Observações */}
                <div>
                  <FL>Observações Internas</FL>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Detalhes sobre o aluno..."
                    className="w-full h-20 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none"
                  />
                </div>
              </div>
            )}

            {/* ══════════════════════════ TAB: PLANO ══════════════════════════ */}
            {activeTab === "plano" && (
              <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">

                {/* Modalidade */}
                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-2">
                  <FL>Modalidade</FL>
                  <FS value={modalidade} onChange={e => setModalidade(e.target.value)}>
                    {MODALIDADES.map(m => <option key={m} value={m}>{m}</option>)}
                  </FS>
                  <p className="text-[9px] text-slate-400">Última seleção salva automaticamente como padrão.</p>
                </div>

                {/* Detalhamento */}
                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <FL>Detalhamento — {modalidade}</FL>
                    <button
                      type="button"
                      onClick={() => setShowAddCampo(v => !v)}
                      className="text-[10px] px-2 py-0.5 bg-emerald-500/10 rounded text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                    >
                      + Campo livre
                    </button>
                  </div>

                  {/* Adicionar campo livre */}
                  {showAddCampo && (
                    <div className="flex gap-2 items-end animate-in slide-in-from-top-2 duration-200">
                      <div className="flex-1">
                        <FL>Rótulo</FL>
                        <FI value={novoCampoLabel} onChange={e => setNovoCampoLabel(e.target.value)} placeholder="Ex: Número de Registro" />
                      </div>
                      <div className="w-24">
                        <FL>Tipo</FL>
                        <FS value={novoCampoTipo} onChange={e => setNovoCampoTipo(e.target.value as CampoTipo)}>
                          <option value="text">Texto</option>
                          <option value="date">Data</option>
                          <option value="number">Número</option>
                        </FS>
                      </div>
                      <button onClick={addCampo} className="h-10 px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500">+</button>
                    </div>
                  )}

                  {/* Grid 2 colunas */}
                  {campos.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-2">Sem campos definidos. Selecione outra modalidade ou adicione campos livres.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {campos.map(c => (
                        <div key={c.id}>
                          <FL>{c.label}</FL>
                          <div className="flex gap-1">
                            {c.tipo === "select" && c.opcoes ? (
                              <FS value={c.value} onChange={e => updateCampo(c.id, e.target.value)} className="flex-1">
                                <option value="">Selecione...</option>
                                {c.opcoes.map(o => <option key={o} value={o}>{o}</option>)}
                              </FS>
                            ) : (
                              <FI
                                type={c.tipo}
                                value={c.value}
                                onChange={e => updateCampo(c.id, e.target.value)}
                                className="flex-1 dark:[color-scheme:dark]"
                                placeholder={c.label}
                              />
                            )}
                            <button
                              onClick={() => setCampos(p => p.filter(x => x.id !== c.id))}
                              className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                              title="Remover"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Servidor e Username foram removidos da interface conforme regra de negócio, mas continuam sendo registrados nos bastidores */}

                {/* Plano / Valor / Vencimento */}
                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Plano</span>
                    {tables.length > 1 && (
                      <FS value={tableId} onChange={e => { setTableId(e.target.value); setPriceTouched(false); }} className="w-auto h-8 px-2 text-xs">
                        {tables.map(t => <option key={t.id} value={t.id}>{t.name} {t.currency}</option>)}
                      </FS>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FL>Recorrência</FL>
                      <FS value={period} onChange={e => { setPeriod(e.target.value); setPriceTouched(false); }}>
                        {Object.entries(PLAN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </FS>
                    </div>
                    <div>
                      <FL>Valor ({currency})</FL>
                      <FI
                        value={planPrice}
                        onChange={e => { setPlanPrice(e.target.value); setPriceTouched(true); }}
                        placeholder="0,00"
                        className="text-right font-bold text-base"
                      />
                    </div>
                  </div>

                  <div>
                    <FL>Vencimento</FL>
                    <FI type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="dark:[color-scheme:dark]" />
                  </div>
                </div>

                {/* Financeiro — somente criação */}
                {!isEditing && (
                  <div className="space-y-2">
                    <div
                      onClick={() => { setRegisterFin(v => !v); setSendMsg(v => !v); }}
                      className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between gap-3 transition-colors ${
                        registerFin
                          ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20"
                          : "bg-slate-50 border-slate-200 dark:bg-white/5 dark:border-white/10"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">💰</span>
                        <div>
                          <span className={`text-xs font-bold block ${registerFin ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`}>
                            Registrar Matrícula no Financeiro
                          </span>
                          <span className="text-[9px] text-slate-400">Gera log de pagamento local</span>
                  </div>
                </div>
                <Switch checked={registerFin} onChange={v => { setRegisterFin(v); setSendMsg(v); }} label="" />
              </div>

              <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 space-y-2">
                <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={() => setSendMsg(v => !v)}>
                  <span className="text-xs font-bold text-slate-600 dark:text-white/70">Enviar mensagem de boas-vindas?</span>
                  <Switch checked={sendMsg} onChange={setSendMsg} label="" />
                </div>

                      {sendMsg && (
                        <div className="animate-in fade-in duration-200 space-y-1">
                          <FS
                            value={templateId}
                            onChange={e => {
                              const id = e.target.value;
                              setTemplateId(id);
                              const tpl = templates.find(t => t.id === id);
                              setMsgContent(tpl?.content || "");
                            }}
                          >
                            <option value="">-- Selecione um modelo --</option>
                            {templates
                              .filter(t => t.category !== "Revenda IPTV" && t.category !== "Revenda SaaS")
                              .map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.id === (typeof window !== "undefined" && localStorage.getItem(LAST_TEMPLATE_KEY)) ? "⭐ " : ""}
                                  {t.name}
                                </option>
                              ))
                            }
                          </FS>
                          <p className="text-[9px] text-slate-400">⭐ = favorito salvo automaticamente ao confirmar</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════ TAB: SAÚDE ══════════════════════════ */}
            {activeTab === "saude" && (
              <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">

                {/* Biometria + IMC */}
                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">📏 Biometria</span>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <FL>Altura (cm)</FL>
                      <FI type="number" min={0} max={250} value={altura} onChange={e => setAltura(e.target.value === "" ? "" : Number(e.target.value))} placeholder="175" />
                    </div>
                    <div>
                      <FL>Peso (kg)</FL>
                      <FI type="number" step={0.1} min={0} value={peso} onChange={e => setPeso(e.target.value === "" ? "" : Number(e.target.value))} placeholder="70.5" />
                    </div>
                    <div>
                      <FL>IMC</FL>
                      <div className="h-10 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 flex flex-col items-center justify-center">
                        {imc > 0 ? (
                          <>
                            <span className="text-sm font-bold text-slate-800 dark:text-white leading-none">{imc.toFixed(1)}</span>
                            <span className={`text-[9px] font-bold leading-none mt-0.5 ${imcInfo?.color}`}>{imcInfo?.label}</span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400 italic">—</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <FL>Objetivo</FL>
                    <FS value={objetivo} onChange={e => setObjetivo(e.target.value)}>
                      <option value="">Selecione...</option>
                      {OBJETIVOS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </FS>
                  </div>
                </div>

                {/* Dados médicos */}
                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">🏥 Dados de Saúde</span>

                  <div className="grid grid-cols-2 gap-2">
                    <BoolRow label="Tabagista (fuma?)" icon="🚬" checked={fuma} onChange={setFuma} />
                    <BoolRow label="Etilista (bebe álcool?)" icon="🍺" checked={bebe} onChange={setBebe} />
                  </div>

                  <div>
                    <FL>Doenças Crônicas / Condições de Saúde</FL>
                    <textarea value={doencas} onChange={e => setDoencas(e.target.value)}
                      placeholder="Ex: Hipertensão, Diabetes, Asma..."
                      className="w-full h-16 px-3 py-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none" />
                  </div>

                  <div>
                    <FL>Histórico Médico</FL>
                    <textarea value={historico} onChange={e => setHistorico(e.target.value)}
                      placeholder="Cirurgias, tratamentos, medicamentos em uso..."
                      className="w-full h-16 px-3 py-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none" />
                  </div>

                  <div>
                    <FL>Lesões / Limitações Físicas</FL>
                    <textarea value={lesoes} onChange={e => setLesoes(e.target.value)}
                      placeholder="Ex: Lesão no joelho direito, hérnia de disco..."
                      className="w-full h-16 px-3 py-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none" />
                  </div>

                  {/* Atestado */}
                  <div>
                    <FL>Atestado Médico</FL>
                    {atestadoUrl ? (
                      <div className="flex items-center gap-3 p-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500 shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <a href={atestadoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 dark:text-emerald-400 font-bold hover:underline flex-1">Ver Atestado</a>
                        <button onClick={() => { setAtestadoUrl(null); setAtestadoFile(null); if (atestadoRef.current) atestadoRef.current.value = ""; }} className="text-xs text-rose-500 font-bold hover:underline">Remover</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => atestadoRef.current?.click()}
                        className="w-full h-10 border-2 border-dashed border-slate-300 dark:border-white/10 rounded-lg text-xs text-slate-400 hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all font-medium"
                      >
                        📎 Carregar Atestado Médico (PDF ou imagem)
                      </button>
                    )}
                    {atestadoFile && !atestadoUrl && (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">📎 {atestadoFile.name} — será enviado ao salvar</p>
                    )}
                    <input ref={atestadoRef} type="file" accept=".pdf,image/*" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) setAtestadoFile(f); }} />
                  </div>
                </div>

                {/* Avaliações físicas */}
                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">📊 Avaliações Físicas</span>
                    <button
                      onClick={() => setShowNovaAv(v => !v)}
                      className="text-[10px] px-2 py-0.5 bg-emerald-500/10 rounded text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                    >
                      + Nova Avaliação
                    </button>
                  </div>

                  {showNovaAv && (
                    <div className="p-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl space-y-3 animate-in slide-in-from-top-2 duration-200">
                      <div className="grid grid-cols-2 gap-2">
                        <div><FL>Data</FL><FI type="date" value={novaAv.data} onChange={e => setNovaAv(v => ({ ...v, data: e.target.value }))} className="dark:[color-scheme:dark]" /></div>
                        <div><FL>Peso (kg)</FL><FI type="number" step={0.1} value={novaAv.peso_kg} onChange={e => setNovaAv(v => ({ ...v, peso_kg: e.target.value === "" ? "" : Number(e.target.value) }))} placeholder="70.5" /></div>
                        <div><FL>% Gordura</FL><FI type="number" step={0.1} value={novaAv.gordura_pct} onChange={e => setNovaAv(v => ({ ...v, gordura_pct: e.target.value === "" ? "" : Number(e.target.value) }))} placeholder="15.0" /></div>
                        <div><FL>Massa Magra (kg)</FL><FI type="number" step={0.1} value={novaAv.massa_magra_kg} onChange={e => setNovaAv(v => ({ ...v, massa_magra_kg: e.target.value === "" ? "" : Number(e.target.value) }))} placeholder="59.5" /></div>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Medidas (cm)</p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {([
                          ["cintura_cm",     "Cintura"    ],
                          ["quadril_cm",     "Quadril"    ],
                          ["braco_cm",       "Braço"      ],
                          ["coxa_cm",        "Coxa"       ],
                          ["panturrilha_cm", "Panturrilha"],
                          ["abdomen_cm",     "Abdômen"    ],
                          ["ombro_cm",       "Ombro"      ],
                        ] as [keyof typeof novaAv, string][]).map(([key, label]) => (
                          <div key={key}>
                            <FL>{label}</FL>
                            <FI
                              type="number"
                              value={novaAv[key]}
                              onChange={e => setNovaAv(v => ({ ...v, [key]: e.target.value === "" ? "" : Number(e.target.value) }))}
                              placeholder="—"
                            />
                          </div>
                        ))}
                      </div>
                      <div><FL>Observações</FL><FI value={novaAv.observacoes} onChange={e => setNovaAv(v => ({ ...v, observacoes: e.target.value }))} placeholder="Observações..." /></div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setShowNovaAv(false)} className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">Cancelar</button>
                        <button onClick={addAvaliacao} className="px-3 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors">Salvar</button>
                      </div>
                    </div>
                  )}

                  {avaliacoes.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-2">Nenhuma avaliação registrada ainda.</p>
                  ) : (
                    <div className="space-y-2">
                      {avaliacoes.map(av => (
                        <div key={av.id} className="flex items-center justify-between p-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-xs gap-3">
                          <div className="flex flex-wrap gap-2 min-w-0">
                            <span className="font-bold text-slate-700 dark:text-white">{new Date(av.data + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                            {av.peso_kg     && <span className="text-slate-500">⚖️ {av.peso_kg}kg</span>}
                            {av.gordura_pct && <span className="text-slate-500">🔥 {av.gordura_pct}%</span>}
                            {av.cintura_cm  && <span className="text-slate-500">C:{av.cintura_cm}</span>}
                            {av.quadril_cm  && <span className="text-slate-500">Q:{av.quadril_cm}</span>}
                            {av.observacoes && <span className="text-slate-400 italic truncate max-w-[120px]">{av.observacoes}</span>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <button
                              onClick={() => gerarPDFAvaliacao(av)}
                              className="px-2.5 py-1.5 bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-500/20 rounded font-bold text-[10px] uppercase tracking-wider transition-colors flex items-center gap-1.5"
                              title="Gerar Relatório em PDF"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>
                              PDF
                            </button>
                            <button
                              onClick={async () => {
                                const ok = await confirmDialog({ title: "Remover avaliação?", subtitle: `Data: ${av.data}`, tone: "rose", confirmText: "Remover", cancelText: "Cancelar" });
                                if (ok) setAvaliacoes(p => p.filter(a => a.id !== av.id));
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded transition-colors"
                              title="Remover avaliação"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* FOOTER */}
          <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-2 rounded-b-xl shrink-0">
            <button onClick={onClose} type="button" className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 text-xs font-bold transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg disabled:opacity-75 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              {loading && (
                <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              )}
              {loading
                ? (loadingStep || "Processando...")
                : (isEditing ? "Salvar Alterações" : "Cadastrar Aluno")}
            </button>
          </div>
        </div>
      </div>

      {ConfirmUI}
    </>
  );
}

// ─── UI ATOMS ─────────────────────────────────────────────────────────────────

function FL({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
      {children}
    </label>
  );
}

function FI({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function FS({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {label && <span className="text-xs text-slate-700 dark:text-white/70">{label}</span>}
      <button
        type="button"
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative w-12 h-7 rounded-full transition-colors border ${checked ? "bg-emerald-600 border-emerald-600" : "bg-slate-200 dark:bg-white/10 border-slate-300 dark:border-white/10"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function PhoneRow({ label, countryLabel, rawValue, onRawChange, onDone }: { label: string; countryLabel: string; rawValue: string; onRawChange: (v: string) => void; onDone: () => void; }) {
  return (
    <div>
      <FL>{label}</FL>
      <div className="flex gap-2">
        <div className="h-10 min-w-[140px] px-3 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-xs font-bold text-slate-700 dark:text-white truncate">
          {countryLabel || "—"}
        </div>
        <div className="relative flex-1">
          <FI value={rawValue} onChange={(e) => onRawChange(e.target.value)} placeholder="Telefone" className="pr-12" />
          <button type="button" onClick={onDone} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center justify-center" title="Normalizar">✓</button>
        </div>
      </div>
    </div>
  );
}

function IconChat() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 4.98 0 11.111c0 3.508 1.777 6.64 4.622 8.67L3.333 24l4.444-2.222c1.333.37 2.592.556 4.223.556 6.627 0 12-4.98 12-11.111S18.627 0 12 0zm0 20c-1.37 0-2.703-.247-3.963-.733l-.283-.111-2.592 1.296.852-2.37-.37-.259C3.852 16.37 2.667 13.852 2.667 11.11 2.667 6.148 6.963 2.222 12 2.222c5.037 0 9.333 3.926 9.333 8.889S17.037 20 12 20zm5.037-6.63c-.278-.139-1.63-.815-1.889-.907-.259-.093-.445-.139-.63.139-.185.278-.722.907-.889 1.093-.167.185-.333.208-.611.069-.278-.139-1.167-.43-2.222-1.37-.822-.733-1.37-1.63-1.528-1.907-.157-.278-.017-.43.122-.569.126-.126.278-.333.417-.5.139-.167.185-.278.278-.463.093-.185.046-.347-.023-.486-.069-.139-.63-1.519-.863-2.083-.227-.546-.458-.472-.63-.48l-.54-.01c-.185 0-.486.069-.74.347-.254.278-.972.95-.972 2.315 0 1.365.996 2.685 1.135 2.87.139.185 1.96 2.997 4.87 4.207.681.294 1.213.47 1.628.602.684.217 1.306.187 1.797.113.548-.082 1.63-.667 1.86-1.31.23-.643.23-1.193.162-1.31-.069-.116-.254-.185-.532-.324z"/>
    </svg>
  );
}

function BoolRow({ label, icon, checked, onChange }: { label: string; icon: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className={`h-10 px-3 rounded-lg border cursor-pointer flex items-center justify-between gap-2 transition-colors ${
        checked
          ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20"
          : "bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/10"
      }`}
    >
      <span className={`text-xs font-medium flex items-center gap-1.5 ${checked ? "text-rose-700 dark:text-rose-400" : "text-slate-500 dark:text-white/50"}`}>
        {icon} {label}
      </span>
      <Switch checked={checked} onChange={onChange} label="" />
    </div>
  );
}

// ─── ÍCONES ───────────────────────────────────────────────────────────────────

function IconX() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>;
}
function IconCamera() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
}
