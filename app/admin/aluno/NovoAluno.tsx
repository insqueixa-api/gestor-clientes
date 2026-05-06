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
  const first = parts[0];
  const last  = parts.length > 1 ? parts[parts.length - 1] : "";
  return (first + last)
    .split("")
    .map((c, i) => i === 0 ? c.toUpperCase() : c.toLowerCase())
    .join("");
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

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 11)     return `+55${digits}`;
  return `+${digits}`;
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
  const [primaryPhone, setPrimaryPhone]   = useState("");
  const [waUsername, setWaUsername]       = useState("");
  const [waOptIn, setWaOptIn]             = useState(true);
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
  const [emergencyPhone, setEmergencyPhone]         = useState("");
  const [emergencyWa, setEmergencyWa]               = useState("");
  const [emergencyRelation, setEmergencyRelation]   = useState("");

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
          setPrimaryPhone(alunoToEdit.whatsapp || "");
          setWaUsername(alunoToEdit.whatsapp_username || "");
          setWaOptIn(alunoToEdit.whatsapp_opt_in ?? true);
          setNotes(alunoToEdit.notes || "");

          if (alunoToEdit.secondary_display_name) {
            setShowEmergency(true);
            setEmergencyName(alunoToEdit.secondary_display_name);
            setEmergencyPhone(alunoToEdit.secondary_phone_e164 || "");
            setEmergencyWa(alunoToEdit.secondary_whatsapp_username || "");
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
      const finalPhone       = normalizePhone(primaryPhone);
      const finalEmergPhone  = normalizePhone(emergencyPhone);
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
          <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 rounded-t-xl shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-lg">🎓</div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white">
                {isEditing ? `Editar: ${alunoToEdit?.name}` : "Novo Aluno"}
              </h2>
            </div>
            <button onClick={onClose} type="button" className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 transition-colors">
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

                {/* Foto + Nome */}
                <div className="flex items-start gap-4">
                  {/* Foto */}
                  <div className="flex-shrink-0 flex flex-col items-center gap-1">
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
                    <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) { setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)); } }} />
                  </div>

                  {/* Nome + saudação */}
                  <div className="flex-1 space-y-3">
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
                    {autoUsername && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg text-[10px]">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        <span className="text-slate-500 dark:text-white/50">Login: <strong className="text-emerald-600 dark:text-emerald-400">{autoUsername}</strong></span>
                        <span className="ml-auto text-slate-400">Servidor: <strong className="text-slate-600 dark:text-white/60">{tenantDisplay}</strong></span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Nascimento + CPF/RG */}
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

                {/* Telefone + WhatsApp */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <FL>Telefone / WhatsApp</FL>
                    <FI
                      value={primaryPhone}
                      type="tel"
                      placeholder="+55 11 99999-9999"
                      onChange={e => {
                        setPrimaryPhone(e.target.value);
                        const d = e.target.value.replace(/\D/g, "");
                        if (!waUsername || waUsername === primaryPhone.replace(/\D/g, "")) setWaUsername(d);
                      }}
                    />
                  </div>
                  <div>
                    <FL>Username WhatsApp</FL>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
                      <FI className="pl-7" value={waUsername} onChange={e => setWaUsername(e.target.value)} placeholder="username" />
                    </div>
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
                        onClick={() => { setShowEmergency(false); setEmergencyName(""); setEmergencyPhone(""); setEmergencyWa(""); setEmergencyRelation(""); }}
                        className="text-[10px] text-rose-500 font-bold hover:bg-rose-500/10 px-2 py-0.5 rounded"
                      >
                        REMOVER
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="col-span-1">
                        <FL>Título</FL>
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
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <FL>Parentesco</FL>
                        <FI value={emergencyRelation} onChange={e => setEmergencyRelation(e.target.value)} placeholder="Mãe, Pai, Cônjuge..." />
                      </div>
                      <div>
                        <FL>Telefone</FL>
                        <FI type="tel" value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} placeholder="+55 11 9..." />
                      </div>
                    </div>
                    <div>
                      <FL>WhatsApp</FL>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
                        <FI className="pl-7" value={emergencyWa} onChange={e => setEmergencyWa(e.target.value)} placeholder="username" />
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
                      <SW checked={waOptIn} onChange={setWaOptIn} />
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

                {/* Servidor + Username — info */}
                <div className="p-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl border border-indigo-200 dark:border-indigo-500/20 space-y-2">
                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Cadastro no Sistema</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FL>Servidor</FL>
                      {servers.length > 1 ? (
                        <FS value={serverId} onChange={e => setServerId(e.target.value)} className="text-xs">
                          {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </FS>
                      ) : (
                        <div className="h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-sm font-bold text-slate-700 dark:text-white">
                          {tenantDisplay}
                        </div>
                      )}
                    </div>
                    <div>
                      <FL>Usuário (gerado)</FL>
                      <div className="h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg flex items-center font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {autoUsername || <span className="text-slate-400 font-normal italic text-xs">Preencha o nome</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Plano / Valor / Vencimento */}
                <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-3">
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
                    <FL>Vencimento (sempre 23:59)</FL>
                    <FI type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="dark:[color-scheme:dark]" />
                    <p className="text-[9px] text-slate-400 mt-1">Padrão: 1 mês a partir de hoje · Horário fixo: 23:59</p>
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
                      <SW checked={registerFin} onChange={v => { setRegisterFin(v); setSendMsg(v); }} />
                    </div>

                    <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 space-y-2">
                      <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={() => setSendMsg(v => !v)}>
                        <span className="text-xs font-bold text-slate-600 dark:text-white/70">Enviar mensagem de boas-vindas?</span>
                        <SW checked={sendMsg} onChange={setSendMsg} />
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
                          <button
                            onClick={async () => {
                              const ok = await confirmDialog({ title: "Remover avaliação?", subtitle: `Data: ${av.data}`, tone: "rose", confirmText: "Remover", cancelText: "Cancelar" });
                              if (ok) setAvaliacoes(p => p.filter(a => a.id !== av.id));
                            }}
                            className="text-slate-400 hover:text-rose-500 transition-colors shrink-0"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          </button>
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

function SW({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? "bg-emerald-600" : "bg-slate-200 dark:bg-white/20"}`}
    >
      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "left-6" : "left-1"}`} />
    </button>
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
      <SW checked={checked} onChange={onChange} />
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
