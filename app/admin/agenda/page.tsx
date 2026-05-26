"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useSearchParams, useRouter } from "next/navigation";
import ToastNotifications, { ToastMessage } from "../ToastNotifications";

// ─── TIPOS ───────────────────────────────────────────────────────────────────
type ContactItem = { label: string; value: string };

type GoogleContact = {
  id: string;
  tenant_id: string;
  google_resource_name: string;
  display_name: string | null;
  phones: ContactItem[] | null;
  emails: ContactItem[] | null;
  avatar_url: string | null;
  birthday: string | null;
  labels: string[] | null;
  synced_at: string;
  phone_e164?: string | null;
  secondary_phone?: string | null;
  email?: string | null;
};

type SortKey = "name" | "labels" | "birthday";
type SortDir = "asc" | "desc";

// Tipo de telefone no editForm — agora com DDI e confirmed separados
type EditPhone = { id: string; label: string; ddi: string; national: string; confirmed: boolean };
type EditEmail = { id: string; label: string; value: string };

// ─── DDI ─────────────────────────────────────────────────────────────────────
type DdiOption = { code: string; label: string; flag: string };

// ⚠️ IMPORTANTE: mantido sorted longest-to-shortest igual ao padrão do sistema
const DDI_OPTIONS: DdiOption[] = [
  { code: "55",  label: "Brasil",          flag: "🇧🇷" },
  { code: "1",   label: "EUA/Canadá",      flag: "🇺🇸" },
  { code: "351", label: "Portugal",        flag: "🇵🇹" },
  { code: "353", label: "Irlanda",         flag: "🇮🇪" },
  { code: "507", label: "Panamá",          flag: "🇵🇦" },
  { code: "506", label: "Costa Rica",      flag: "🇨🇷" },
  { code: "595", label: "Paraguai",        flag: "🇵🇾" },
  { code: "591", label: "Bolívia",         flag: "🇧🇴" },
  { code: "234", label: "Nigéria",         flag: "🇳🇬" },
  { code: "254", label: "Quênia",          flag: "🇰🇪" },
  { code: "212", label: "Marrocos",        flag: "🇲🇦" },
  { code: "971", label: "Emirados Árabes", flag: "🇦🇪" },
  { code: "966", label: "Arábia Saudita",  flag: "🇸🇦" },
  { code: "44",  label: "Reino Unido",     flag: "🇬🇧" },
  { code: "34",  label: "Espanha",         flag: "🇪🇸" },
  { code: "49",  label: "Alemanha",        flag: "🇩🇪" },
  { code: "33",  label: "França",          flag: "🇫🇷" },
  { code: "39",  label: "Itália",          flag: "🇮🇹" },
  { code: "52",  label: "México",          flag: "🇲🇽" },
  { code: "54",  label: "Argentina",       flag: "🇦🇷" },
  { code: "56",  label: "Chile",           flag: "🇨🇱" },
  { code: "57",  label: "Colômbia",        flag: "🇨🇴" },
  { code: "58",  label: "Venezuela",       flag: "🇻🇪" },
  { code: "32",  label: "Bélgica",         flag: "🇧🇪" },
  { code: "46",  label: "Suécia",          flag: "🇸🇪" },
  { code: "31",  label: "Holanda",         flag: "🇳🇱" },
  { code: "41",  label: "Suíça",           flag: "🇨🇭" },
  { code: "45",  label: "Dinamarca",       flag: "🇩🇰" },
  { code: "48",  label: "Polônia",         flag: "🇵🇱" },
  { code: "30",  label: "Grécia",          flag: "🇬🇷" },
  { code: "27",  label: "África do Sul",   flag: "🇿🇦" },
  { code: "20",  label: "Egito",           flag: "🇪🇬" },
  { code: "86",  label: "China",           flag: "🇨🇳" },
  { code: "91",  label: "Índia",           flag: "🇮🇳" },
  { code: "81",  label: "Japão",           flag: "🇯🇵" },
  { code: "82",  label: "Coreia do Sul",   flag: "🇰🇷" },
  { code: "66",  label: "Tailândia",       flag: "🇹🇭" },
  { code: "62",  label: "Indonésia",       flag: "🇮🇩" },
  { code: "60",  label: "Malásia",         flag: "🇲🇾" },
  { code: "98",  label: "Irã",             flag: "🇮🇷" },
  { code: "90",  label: "Turquia",         flag: "🇹🇷" },
  { code: "61",  label: "Austrália",       flag: "🇦🇺" },
  { code: "64",  label: "Nova Zelândia",   flag: "🇳🇿" },
];

function onlyDigits(raw: string) { return (raw || "").replace(/\D+/g, ""); }

// Infere DDI testando do maior código pro menor (evita colisão 1 vs 353)
function inferDDI(digits: string): string {
  if (!digits) return "55";
  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) {
    if (digits.startsWith(opt.code)) return opt.code;
  }
  return "55";
}

// Formata o número nacional por DDI
function formatNational(ddi: string, nat: string): string {
  let d = onlyDigits(nat);
  // Usuário digitou "021..." em vez de "21..." — strip o zero inicial
  if (ddi === "55" && d.startsWith("0")) d = d.slice(1);
  if (ddi === "55") {
    const area = d.slice(0, 2);
    const rest = d.slice(2);
    if (!area) return d;
    if (rest.length === 9) return `${area} ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `${area} ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `${area} ${rest}`.trim();
  }
  // Genérico: agrupa em blocos
  const groups: string[] = [];
  let i = 0;
  while (i < d.length) { const step = d.length - i > 7 ? 3 : 4; groups.push(d.slice(i, i + step)); i += step; }
  return groups.join(" ").trim();
}

// 🌟 NOVA função central de exibição:
// Brasil  → (021) 99999-8888
// Outros  → 🇵🇹 +351 XXX XXX XXX
function displayPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = onlyDigits(raw);
  if (!digits) return raw || "";

  const hasPlus = (raw.trim()).startsWith("+");
  let ddi = "55";
  let national = digits;

  if (hasPlus || digits.length > 11) {
    ddi = inferDDI(digits);
    national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
  }

  if (ddi === "55") {
    if (national.startsWith("0")) national = national.slice(1);
    const ddd = national.slice(0, 2);
    const rest = national.slice(2);
    if (rest.length === 9) return `(0${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `(0${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `(0${ddd}) ${rest}`.trim();
  }

  const opt = DDI_OPTIONS.find(o => o.code === ddi);
  const flag = opt?.flag || "🌐";
  return `${flag} +${ddi} ${formatNational(ddi, national)}`;
}

// Converte um phone raw (ex: "+5521999998888" ou "21999998888") para EditPhone
function parsePhoneToEditPhone(raw: string, label: string, id: string): EditPhone {
  const digits = onlyDigits(raw);
  if (!digits) return { id, label, ddi: "55", national: "", confirmed: false };
  let ddi = "55";
  let national = digits;
  if (digits.length > 11 || raw.trim().startsWith("+")) {
    ddi = inferDDI(digits);
    national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
  }
  return { id, label, ddi, national: formatNational(ddi, national) || national, confirmed: true };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function compareText(a: string, b: string) {
  return (a || "").localeCompare(b || "", "pt-BR", { sensitivity: "base" });
}

function formatBirthday(b: string | null) {
  if (!b) return "—";
  const parts = b.split("-");
  if (parts.length >= 3) return `${parts[parts.length - 1]}/${parts[parts.length - 2]}`;
  return b;
}

function getBirthdayMonth(b: string | null): number | null {
  if (!b) return null;
  const parts = b.split("-");
  if (parts.length >= 2) { const m = parseInt(parts[parts.length - 2], 10); return isNaN(m) ? null : m; }
  return null;
}

function getPhonesArray(contact: GoogleContact): { id: string; label: string; value: string }[] {
  if (contact.phones && Array.isArray(contact.phones) && contact.phones.length > 0) {
    return contact.phones.map((p, i) => ({ id: i.toString(), label: p.label || "Celular", value: p.value }));
  }
  const arr = [];
  if (contact.phone_e164) arr.push({ id: "old1", label: "Celular", value: contact.phone_e164 });
  if (contact.secondary_phone) arr.push({ id: "old2", label: "Telefone", value: contact.secondary_phone });
  return arr;
}

function getEmailsArray(contact: GoogleContact): { id: string; label: string; value: string }[] {
  if (contact.emails && Array.isArray(contact.emails) && contact.emails.length > 0) {
    return contact.emails.map((e, i) => ({ id: i.toString(), label: e.label || "Pessoal", value: e.value }));
  }
  if (contact.email) return [{ id: "old1", label: "Pessoal", value: contact.email }];
  return [];
}

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// ─── PAGE ────────────────────────────────────────────────────────────────────
function AgendaPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [rows, setRows] = useState<GoogleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState("Todos");
  const [emailLabelFilter, setEmailLabelFilter] = useState("Todos");
  const [birthdayMonthFilter, setBirthdayMonthFilter] = useState<number | null>(null);
  const [pageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const uniqueLabels = useMemo(
    () => Array.from(new Set(rows.flatMap(r => r.labels || []))).sort(),
    [rows]
  );
  const uniqueEmailLabels = useMemo(
    () => Array.from(new Set(rows.flatMap(r => getEmailsArray(r).map(e => e.label)))).sort(),
    [rows]
  );

  const [showMobileFilters, setShowMobileFilters] = useState(false);
const hasActiveFilters = labelFilter !== "Todos" || emailLabelFilter !== "Todos" || birthdayMonthFilter !== null;

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  function addToast(type: "success" | "error" | "warning", title: string, message?: string) {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, title, message }]);
    if (toastTimersRef.current[id]) clearTimeout(toastTimersRef.current[id]);
    toastTimersRef.current[id] = setTimeout(() => removeToast(id), 5000);
  }
  function removeToast(id: number) {
    if (toastTimersRef.current[id]) { clearTimeout(toastTimersRef.current[id]); delete toastTimersRef.current[id]; }
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  // Msg menu / Send
  const [msgMenuForId, setMsgMenuForId] = useState<string | null>(null);
  const [showSendNow, setShowSendNow] = useState<{ open: boolean; contactId: string | null; phone: string | null }>({ open: false, contactId: null, phone: null });
  const [messageText, setMessageText] = useState("");
  const [sendingNow, setSendingNow] = useState(false);
  const [sessionOptions, setSessionOptions] = useState<{ id: string; label: string }[]>([{ id: "default", label: "Carregando..." }]);
  const [selectedSessionNow, setSelectedSessionNow] = useState("default");

  // Edit modal
  const [editModal, setEditModal] = useState<{ open: boolean; contact: GoogleContact | null }>({ open: false, contact: null });
  const [editForm, setEditForm] = useState<{
    display_name: string;
    phones: EditPhone[];
    emails: EditEmail[];
    labels: string[];
    new_photo_base64?: string;
  }>({ display_name: "", phones: [], emails: [], labels: [] });
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WA validation por phoneId
  type WaValidation = { loading: boolean; exists: boolean; jid?: string } | null;
  const [waValidations, setWaValidations] = useState<Record<string, WaValidation>>({});
  const waTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  async function validateWaForPhone(phoneId: string, e164: string) {
    const digits = onlyDigits(e164);
    if (digits.length < 8) {
      setWaValidations(prev => { const n = { ...prev }; delete n[phoneId]; return n; });
      return;
    }
    setWaValidations(prev => ({ ...prev, [phoneId]: { loading: true, exists: false } }));
    try {
      const res = await fetch("/api/whatsapp/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const json = await res.json().catch(() => ({}));
      setWaValidations(prev => ({ ...prev, [phoneId]: { loading: false, exists: !!json.exists, jid: json.jid } }));
    } catch {
      setWaValidations(prev => ({ ...prev, [phoneId]: { loading: false, exists: false } }));
    }
  }

  // Delete modal
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; contact: GoogleContact | null }>({ open: false, contact: null });
  const [deleteFromGoogle, setDeleteFromGoogle] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  // ─── UTILS ─────────────────────────────────────────────────────────────────
  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds(prev => { const next = new Set(prev); if (checked) next.add(id); else next.delete(id); return next; });
  }

  async function handleMassSyncOperadora() {
    if (selectedIds.size === 0) return;
    addToast("warning", "Em desenvolvimento", `Sincronizando operadora para ${selectedIds.size} contatos.`);
    setSelectedIds(new Set());
  }

  // ─── EFEITOS ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const syncStatus = searchParams.get("sync");
    const syncCount = searchParams.get("count");
    if (syncStatus === "success") {
      addToast("success", "Sincronização concluída", `${syncCount} contatos importados do Google.`);
      router.replace("/admin/agenda");
    }
    loadData();
    loadWhatsAppSessions();
  }, [searchParams]);

  async function loadData() {
    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      setTenantId(tid);
      if (!tid) return;
      const { data, error } = await supabaseBrowser.from("google_contacts").select("*").eq("tenant_id", tid);
      if (error) throw error;
      setRows(data || []);
    } catch (e: any) {
      addToast("error", "Erro ao carregar", e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadWhatsAppSessions() {
    try {
      const res = await fetch("/api/whatsapp/status").then(r => r.json()).catch(() => ({}));
      setSessionOptions([{ id: "default", label: res.connected ? "Contato Principal (Conectado)" : "Contato Principal (Desconectado)" }]);
    } catch {
      setSessionOptions([{ id: "default", label: "Sessão Padrão" }]);
    }
  }

  // ─── FILTROS & ORDENAÇÃO ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return rows.filter(r => {
      if (labelFilter !== "Todos" && (!r.labels || !r.labels.includes(labelFilter))) return false;
      if (emailLabelFilter !== "Todos") {
        const eLbls = getEmailsArray(r).map(e => e.label);
        if (!eLbls.includes(emailLabelFilter)) return false;
      }
      if (birthdayMonthFilter !== null && getBirthdayMonth(r.birthday) !== birthdayMonthFilter) return false;
      if (q) {
        const hay = [r.display_name, getPhonesArray(r).map(p => p.value).join(" "), getEmailsArray(r).map(e => e.value).join(" "), ...(r.labels || [])]
          .join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, labelFilter, emailLabelFilter, birthdayMonthFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = compareText(a.display_name || "", b.display_name || "");
      else if (sortKey === "birthday") cmp = compareText(a.birthday || "", b.birthday || "");
      else if (sortKey === "labels") cmp = compareText((a.labels || []).join(""), (b.labels || []).join(""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function setAllVisible(checked: boolean) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const r of visible) { if (checked) next.add(r.id); else next.delete(r.id); }
      return next;
    });
  }

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const total = visible.length;
    const sel = visible.filter(r => selectedIds.has(r.id)).length;
    el.indeterminate = sel > 0 && sel < total;
  }, [selectedIds, visible]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(nextKey); setSortDir("asc"); }
  }

  // ─── AÇÕES ─────────────────────────────────────────────────────────────────
  async function handleSendMessage() {
    if (!tenantId || !showSendNow.contactId || !showSendNow.phone) return;
    const msg = messageText.trim();
    if (!msg) return addToast("error", "Mensagem vazia", "Digite algo.");
    setSendingNow(true);
    try {
      const res = await fetch("/api/whatsapp/envio_avulso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, phone_e164: showSendNow.phone, message: msg, whatsapp_session: selectedSessionNow }),
      });
      if (!res.ok) throw new Error("Falha ao enviar");
      addToast("success", "Enviado", "Mensagem enviada com sucesso.");
      setShowSendNow({ open: false, contactId: null, phone: null });
      setMessageText("");
    } catch (e: any) {
      addToast("error", "Falha no envio", e.message);
    } finally {
      setSendingNow(false);
    }
  }

  async function handleSilentSync() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/google/sync-silent", { method: "POST" });
      const data = await res.json();
      if (res.ok) { addToast("success", "Sincronização concluída", `${data.count} contatos importados.`); loadData(); }
      else { addToast("warning", "Acesso necessário", "Redirecionando para o Google..."); window.location.href = "/api/auth/google"; }
    } catch (err: any) {
      addToast("error", "Erro ao sincronizar", err.message);
    } finally {
      setLoading(false);
    }
  }

  // ─── MODAL EDIT ────────────────────────────────────────────────────────────
  function openEditModal(contact: GoogleContact) {
    const phones = getPhonesArray(contact).map(p => parsePhoneToEditPhone(p.value, p.label, p.id));
    const emails = getEmailsArray(contact).map(e => ({ ...e }));
    setEditForm({ display_name: contact.display_name || "", phones, emails, labels: contact.labels || [], new_photo_base64: undefined });
    setWaValidations({});
    setEditModal({ open: true, contact });
  }

  function openCreateModal() {
    setEditForm({ display_name: "", phones: [{ id: Date.now().toString(), label: "Celular", ddi: "55", national: "", confirmed: false }], emails: [], labels: [], new_photo_base64: undefined });
    setWaValidations({});
    setEditModal({ open: true, contact: null });
  }

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setEditForm(prev => ({ ...prev, new_photo_base64: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

  // Confirma e normaliza um telefone do modal, dispara validação WA
  function confirmPhone(idx: number) {
    setEditForm(prev => {
      const phones = [...prev.phones];
      const p = phones[idx];
      let digits = onlyDigits(p.national);
    // Strip zero inicial para Brasil (ex: "021..." → "21...")
    if (p.ddi === "55" && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length < 8) {
        phones[idx] = { ...p, confirmed: false };
        return { ...prev, phones };
      }
      // Se o usuário colou o número inteiro com DDI, detecta automaticamente
      let ddi = p.ddi;
      let national = digits;
      if (digits.length > 11) {
        ddi = inferDDI(digits);
        national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
      }
      const formatted = formatNational(ddi, national);
      phones[idx] = { ...p, ddi, national: formatted || national, confirmed: true };

      // Dispara validação WA com debounce
      const e164 = `+${ddi}${onlyDigits(formatted || national)}`;
      if (waTimers.current[p.id]) clearTimeout(waTimers.current[p.id]);
      waTimers.current[p.id] = setTimeout(() => validateWaForPhone(p.id, e164), 400);

      return { ...prev, phones };
    });
  }

  // Sincroniza foto do WhatsApp (requer rota /api/whatsapp/contact-photo na VM)
  async function handleSyncWaPhoto(phoneId: string, contactId: string) {
    const wa = waValidations[phoneId];
    if (!wa?.exists || !wa.jid) return;
    try {
      const res = await fetch("/api/whatsapp/contact-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, jid: wa.jid }),
      });
      const data = await res.json();
      if (res.ok && data.avatar_url) {
        addToast("success", "Foto atualizada", "Foto do WhatsApp sincronizada com sucesso.");
        loadData();
        setEditModal(prev => ({ ...prev, contact: prev.contact ? { ...prev.contact, avatar_url: data.avatar_url } : null }));
      } else {
        addToast("warning", "Foto protegida", "Este contato tem a foto privada no WhatsApp.");
      }
    } catch {
      addToast("error", "Erro", "Rota /api/whatsapp/contact-photo ainda não implementada na VM.");
    }
  }

  async function handleSaveContact() {
    setIsSaving(true);
    try {
      const isNew = !editModal.contact;
      const endpoint = isNew ? "/api/auth/google/create" : "/api/auth/google/update";

      // Reconstrói os phones com e164 completo para o backend
      const phones = editForm.phones
        .filter(p => p.national.trim())
        .map(p => ({ label: p.label, value: `+${p.ddi}${onlyDigits(p.national)}` }));

      const payload = {
        id: editModal.contact?.id,
        google_resource_name: editModal.contact?.google_resource_name,
        display_name: editForm.display_name,
        phones,
        emails: editForm.emails.map(e => ({ label: e.label, value: e.value })),
        labels: editForm.labels,
        photo_base64: editForm.new_photo_base64,
      };

      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Erro ao salvar."); }
      addToast("success", "Salvo", `Contato ${isNew ? "criado" : "atualizado"} com sucesso.`);
      setEditModal({ open: false, contact: null });
      loadData();
    } catch (err: any) {
      addToast("error", "Aviso de API", err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteContact() {
    if (!deleteModal.contact) return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/auth/google/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteModal.contact.id, resourceName: deleteModal.contact.google_resource_name, deleteFromGoogle }),
      });
      if (!res.ok) throw new Error("Erro ao excluir.");
      addToast("success", "Excluído", `Contato removido${deleteFromGoogle ? " do sistema e do Google" : " apenas do sistema"}.`);
      setDeleteModal({ open: false, contact: null });
      loadData();
    } catch (err: any) {
      addToast("error", "Aviso de API", err.message);
    } finally {
      setIsDeleting(false);
    }
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div
      className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors"
      onClick={() => setMsgMenuForId(null)}
    >

      {/* HEADER */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">Agenda de Contatos</h1>
          <p className="text-xs text-slate-500 dark:text-white/50 mt-1">Gerencie os contatos sincronizados com o Google.</p>
        </div>
        <div className="flex items-center gap-2 justify-end shrink-0">
          <button onClick={openCreateModal} className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all">
            + Novo Contato
          </button>
          <button onClick={handleSilentSync} disabled={loading} className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-blue-900/20 transition-all disabled:opacity-50">
            <IconSync /> {loading ? "Sincronizando..." : "Sincronizar"}
          </button>
        </div>
      </div>

      {/* FILTROS */}
      <div className="px-3 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm mb-4 z-20">
  {/* UMA linha no desktop, busca + botão filtros no mobile */}
  <div className="flex gap-2 items-center">
    <div className="flex-1">
      <input
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(1); }}
        placeholder="Pesquisar por nome, telefone ou email..."
        className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20"
      />
    </div>

    {/* Filtros inline — visíveis só no desktop */}
    <div className="hidden md:flex items-center gap-2">
      <select
        value={labelFilter}
        onChange={e => { setLabelFilter(e.target.value); setPage(1); }}
        className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white"
      >
        <option value="Todos">Grupo (Todos)</option>
        {uniqueLabels.map(lbl => <option key={lbl} value={lbl}>{lbl}</option>)}
      </select>

      <select
        value={emailLabelFilter}
        onChange={e => { setEmailLabelFilter(e.target.value); setPage(1); }}
        className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white"
      >
        <option value="Todos">📧 E-mail (Todos)</option>
        {uniqueEmailLabels.map(lbl => <option key={lbl} value={lbl}>{lbl}</option>)}
      </select>

      <select
        value={birthdayMonthFilter ?? ""}
        onChange={e => { setBirthdayMonthFilter(e.target.value ? parseInt(e.target.value) : null); setPage(1); }}
        className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white"
      >
        <option value="">🎂 Aniversário (Todos)</option>
        {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
      </select>

      {hasActiveFilters && (
        <button
          onClick={() => { setLabelFilter("Todos"); setEmailLabelFilter("Todos"); setBirthdayMonthFilter(null); setPage(1); }}
          className="h-10 px-3 rounded-lg text-xs font-bold text-rose-500 border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors whitespace-nowrap"
        >
          ✕ Limpar
        </button>
      )}
    </div>

    {/* Botão filtros — só no mobile */}
    <button
      onClick={() => setShowMobileFilters(v => !v)}
      className={`md:hidden h-10 px-3 rounded-lg border text-sm font-bold transition-colors flex items-center gap-1.5 ${
        hasActiveFilters
          ? "bg-amber-500 text-white border-amber-500"
          : "bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M7 12h10M11 18h2"/></svg>
      {hasActiveFilters ? "Filtros ●" : "Filtros"}
    </button>
  </div>

  {/* Painel expandido no mobile */}
  {showMobileFilters && (
    <div className="md:hidden flex flex-col gap-2 mt-2 animate-in slide-in-from-top-2">
      <select
        value={labelFilter}
        onChange={e => { setLabelFilter(e.target.value); setPage(1); }}
        className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white"
      >
        <option value="Todos">Grupo (Todos)</option>
        {uniqueLabels.map(lbl => <option key={lbl} value={lbl}>{lbl}</option>)}
      </select>

      <select
        value={emailLabelFilter}
        onChange={e => { setEmailLabelFilter(e.target.value); setPage(1); }}
        className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white"
      >
        <option value="Todos">📧 E-mail (Todos)</option>
        {uniqueEmailLabels.map(lbl => <option key={lbl} value={lbl}>{lbl}</option>)}
      </select>

      <select
        value={birthdayMonthFilter ?? ""}
        onChange={e => { setBirthdayMonthFilter(e.target.value ? parseInt(e.target.value) : null); setPage(1); }}
        className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white"
      >
        <option value="">🎂 Aniversário (Todos)</option>
        {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
      </select>

      {hasActiveFilters && (
        <button
          onClick={() => { setLabelFilter("Todos"); setEmailLabelFilter("Todos"); setBirthdayMonthFilter(null); setPage(1); }}
          className="h-10 px-3 rounded-lg text-sm font-bold text-rose-500 border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10"
        >
          ✕ Limpar filtros
        </button>
      )}
    </div>
  )}
</div>

      {/* SELEÇÃO EM MASSA */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-500/30 rounded-xl mb-4 animate-in slide-in-from-top-2 mx-3 sm:mx-0">
          <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{selectedIds.size} contato(s) selecionado(s)</span>
          <button onClick={handleMassSyncOperadora} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-colors">
            Sincronizar Operadora
          </button>
        </div>
      )}

      {/* TABELA */}
      {!loading && (
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0">
          <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-bold tracking-tight text-slate-800 dark:text-white whitespace-nowrap">
              Lista de Contatos{" "}
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold">{filtered.length}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[250px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold uppercase text-slate-500 dark:text-white/55">
                  <Th width={40}>
                    <input ref={selectAllRef} type="checkbox" checked={visible.length > 0 && visible.every(r => selectedIds.has(r.id))} onChange={e => setAllVisible(e.target.checked)} className="rounded border-slate-300 dark:border-white/20 bg-slate-100 dark:bg-white/5" />
                  </Th>
                  <ThSort label="Contato" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                  <Th>Telefones</Th>
                  <Th>E-mails</Th>
                  <Th align="center"><SortClick label="Aniversário" active={sortKey === "birthday"} dir={sortDir} onClick={() => toggleSort("birthday")} /></Th>
                  <Th align="center"><SortClick label="Grupo" active={sortKey === "labels"} dir={sortDir} onClick={() => toggleSort("labels")} /></Th>
                  <Th align="center">Ações</Th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
                {visible.map(r => {
                  const rPhones = getPhonesArray(r);
                  const rEmails = getEmailsArray(r);
                  return (
                    <tr
                      key={r.id}
                      className={`transition-colors group cursor-pointer ${selectedIds.has(r.id) ? "bg-indigo-50/50 dark:bg-indigo-500/10" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
                      onClick={() => toggleSelected(r.id, !selectedIds.has(r.id))}
                    >
                      <Td>
                        <input type="checkbox" checked={selectedIds.has(r.id)} onChange={e => toggleSelected(r.id, e.target.checked)} onClick={e => e.stopPropagation()} className="rounded border-slate-300 dark:border-white/20 bg-slate-100 dark:bg-white/5" />
                      </Td>

                      {/* FOTO + NOME */}
                      <Td>
                        <div className="flex items-center gap-4 py-2">
                          {r.avatar_url ? (
                            <img src={r.avatar_url} alt="Foto" className="w-[56px] h-[56px] rounded-full object-cover border border-slate-200 dark:border-white/10 shadow-sm shrink-0" />
                          ) : (
                            <div className="w-[56px] h-[56px] rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center font-bold text-slate-500 dark:text-white/50 text-xl shrink-0">
                              {r.display_name?.charAt(0) || "?"}
                            </div>
                          )}
                          <div className="font-bold text-base text-slate-800 dark:text-white">{r.display_name || "Sem Nome"}</div>
                        </div>
                      </Td>

                      {/* TELEFONES */}
                      <Td>
                        <div className="flex flex-col gap-1.5 py-2">
                          {rPhones.length > 0 ? rPhones.map(p => (
                            <div key={p.id} className="text-[13px]">
                              <span className="font-bold text-slate-500 dark:text-white/50">{p.label}: </span>
                              <span className="font-mono font-bold text-slate-800 dark:text-white/90">{displayPhone(p.value)}</span>
                            </div>
                          )) : <span className="italic text-slate-400 text-xs">Sem telefone</span>}
                        </div>
                      </Td>

                      {/* EMAILS */}
                      <Td>
                        <div className="flex flex-col gap-1.5 py-2">
                          {rEmails.length > 0 ? rEmails.map(e => (
                            <div key={e.id} className="text-[13px] truncate max-w-[200px]">
                              <span className="font-bold text-slate-500 dark:text-white/50">{e.label}: </span>
                              <span className="text-sky-600 dark:text-sky-400">{e.value}</span>
                            </div>
                          )) : <span className="italic text-slate-400 text-xs">—</span>}
                        </div>
                      </Td>

                      <Td align="center">
                        <span className="text-slate-600 dark:text-white/80">{formatBirthday(r.birthday)}</span>
                      </Td>

                      <Td align="center">
                        <div className="flex flex-wrap gap-1 justify-center max-w-[200px] mx-auto">
                          {r.labels && r.labels.length > 0 ? r.labels.map(l => (
                            <span key={l} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/[0.08] text-slate-600 dark:text-white/75 border border-slate-200 dark:border-white/15">{l}</span>
                          )) : <span className="text-slate-300 dark:text-white/20 text-xs italic">—</span>}
                        </div>
                      </Td>

                      <Td align="right">
                        <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 relative">
                          <div className="relative">
                            <IconActionBtn title="WhatsApp" tone="green" onClick={e => {
                              e.stopPropagation();
                              if (rPhones.length === 0) return addToast("warning", "Sem telefone", "Este contato não possui um número válido.");
                              setMsgMenuForId(cur => cur === r.id ? null : r.id);
                            }}>
                              <IconChat />
                            </IconActionBtn>
                            {msgMenuForId === r.id && (
                              <div onClick={e => e.stopPropagation()} className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0f141a] z-50 shadow-2xl overflow-hidden">
                                {rPhones.map(p => (
                                  <MenuItem key={p.id} icon={<IconSend />} label={`Para: ${p.label}`} onClick={() => {
                                    setMsgMenuForId(null);
                                    setMessageText("");
                                    setShowSendNow({ open: true, contactId: r.id, phone: p.value });
                                  }} />
                                ))}
                              </div>
                            )}
                          </div>
                          <IconActionBtn title="Editar Contato" tone="amber" onClick={e => { e.stopPropagation(); openEditModal(r); }}>
                            <IconEdit />
                          </IconActionBtn>
                          <IconActionBtn title="Excluir" tone="red" onClick={e => { e.stopPropagation(); setDeleteModal({ open: true, contact: r }); }}>
                            <IconTrash />
                          </IconActionBtn>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="h-24 md:h-20" />
          </div>
        </div>
      )}

      {/* ── MODAL WHATSAPP ───────────────────────────────────────────────── */}
      {showSendNow.open && (
        <Modal title="Enviar Mensagem Rápida" onClose={() => setShowSendNow({ open: false, contactId: null, phone: null })}>
          <div className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 p-3 rounded-lg flex items-center gap-3">
              <span className="text-xl">💬</span>
              <div className="text-sm text-emerald-900 dark:text-emerald-200">
                Enviando para <strong className="font-mono">{displayPhone(showSendNow.phone!)}</strong>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Sessão de Envio</label>
              <select value={selectedSessionNow} onChange={e => setSelectedSessionNow(e.target.value)} className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none text-sm font-medium">
                {sessionOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <textarea value={messageText} onChange={e => setMessageText(e.target.value)} className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl p-4 text-slate-800 dark:text-white outline-none min-h-[120px] text-sm resize-none" placeholder="Digite a sua mensagem..." autoFocus />
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowSendNow({ open: false, contactId: null, phone: null })} className="px-4 py-2 rounded-lg text-slate-500 dark:text-white/40 text-sm font-bold">Cancelar</button>
              <button onClick={handleSendMessage} disabled={sendingNow} className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-2 text-sm disabled:opacity-50">
                <IconSend /> {sendingNow ? "Enviando..." : "Enviar Agora"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL CRIAR / EDITAR ─────────────────────────────────────────── */}
      {editModal.open && (
        <Modal title={editModal.contact ? "Editar Contato" : "Novo Contato"} onClose={() => setEditModal({ open: false, contact: null })}>
          <div className="space-y-5 max-h-[80vh] overflow-y-auto px-1 pb-4">

            {/* Foto clicável */}
            <div className="flex justify-center mb-2 relative group w-24 h-24 mx-auto cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handlePhotoUpload} />
              {editForm.new_photo_base64 || editModal.contact?.avatar_url ? (
                <img src={editForm.new_photo_base64 || editModal.contact?.avatar_url || ""} alt="Foto" className="w-24 h-24 rounded-full object-cover border-2 border-slate-200 dark:border-white/20 group-hover:opacity-50 transition-opacity" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center font-bold text-slate-500 dark:text-white/40 text-2xl group-hover:opacity-50 transition-opacity">
                  {editForm.display_name?.charAt(0) || "?"}
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white drop-shadow-md text-sm font-bold">📸 Alterar</div>
            </div>

            {/* Nome */}
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1">Nome Completo</label>
              <input
                value={editForm.display_name}
                onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                className="w-full p-2.5 border border-slate-200 dark:border-white/10 rounded-lg bg-slate-50 dark:bg-black/20 text-slate-800 dark:text-white outline-none focus:border-amber-500 text-sm font-bold"
              />
            </div>

            <div className="border-t border-slate-200 dark:border-white/10" />

            {/* ── TELEFONES ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-bold text-slate-500 dark:text-white/40">Telefones</label>
                <button
                  onClick={() => setEditForm(prev => ({ ...prev, phones: [...prev.phones, { id: Date.now().toString(), label: "Celular", ddi: "55", national: "", confirmed: false }] }))}
                  className="text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1"
                >
                  + Add Telefone
                </button>
              </div>

              <div className="space-y-4">
                {editForm.phones.map((p, idx) => {
                  const wa = waValidations[p.id];
                  const e164Preview = p.confirmed && p.national ? `+${p.ddi}${onlyDigits(p.national)}` : null;

                  return (
                    <div key={p.id} className="space-y-2 p-3 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-black/10">
                      {/* Linha 1: rótulo + DDI + número + confirmar + remover */}
                      <div className="flex gap-2 items-center">
                        {/* Rótulo */}
                        <input
                          placeholder="Rótulo"
                          value={p.label}
                          onChange={e => setEditForm(prev => { const phones = [...prev.phones]; phones[idx] = { ...phones[idx], label: e.target.value }; return { ...prev, phones }; })}
                          className="w-20 p-2 border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-black/30 text-slate-800 dark:text-white text-xs font-bold"
                        />
                        {/* DDI */}
                        <select
                          value={p.ddi}
                          onChange={e => setEditForm(prev => { const phones = [...prev.phones]; phones[idx] = { ...phones[idx], ddi: e.target.value, confirmed: false }; return { ...prev, phones }; })}
                          className="h-9 px-2 bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-xs text-slate-700 dark:text-white"
                        >
                          {DDI_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.flag} +{o.code}</option>)}
                        </select>
                        {/* Número nacional */}
                        <input
                          placeholder={p.ddi === "55" ? "21 99999-9999" : "número"}
                          value={p.national}
                          onChange={e => setEditForm(prev => { const phones = [...prev.phones]; phones[idx] = { ...phones[idx], national: e.target.value, confirmed: false }; return { ...prev, phones }; })}
                          onBlur={() => confirmPhone(idx)}
                          className="flex-1 p-2 border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-black/20 text-slate-800 dark:text-white text-sm font-mono min-w-0"
                        />
                        {/* Botão confirmar */}
                        <button
                          onClick={() => confirmPhone(idx)}
                          title="Confirmar e validar número"
                          className={`px-2.5 py-2 rounded-lg border text-xs font-bold transition-colors ${p.confirmed ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-slate-200 dark:border-white/10 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"}`}
                        >✓</button>
                        {/* Remover */}
                        <button
                          onClick={() => { setEditForm(prev => ({ ...prev, phones: prev.phones.filter(x => x.id !== p.id) })); setWaValidations(prev => { const n = { ...prev }; delete n[p.id]; return n; }); }}
                          className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg"
                        ><IconTrash /></button>
                      </div>

                      {/* Linha 2: preview formatado + status WhatsApp */}
                      <div className="flex flex-wrap items-center gap-3 px-1">
                        {e164Preview && (
                          <span className="text-[11px] font-mono text-slate-400 dark:text-white/30">
                            {displayPhone(e164Preview)}
                          </span>
                        )}
                        {wa && (
                          <span className={`text-[11px] font-bold flex items-center gap-1.5 ${wa.loading ? "text-slate-400" : wa.exists ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
                            {wa.loading ? (
                              <>
                                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                Validando WA...
                              </>
                            ) : wa.exists ? (
                              <>
                                ✅ WhatsApp ativo
                                {editModal.contact && (
                                  <button
                                    onClick={() => handleSyncWaPhoto(p.id, editModal.contact!.id)}
                                    title="Buscar foto do WhatsApp"
                                    className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-200 dark:hover:bg-emerald-500/25 transition-colors font-bold"
                                  >
                                    📸 Foto WA
                                  </button>
                                )}
                              </>
                            ) : (
                              <>❌ Não encontrado no WA</>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {editForm.phones.length === 0 && <div className="text-xs text-slate-400 dark:text-white/30 italic">Nenhum telefone.</div>}
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-white/10" />

            {/* ── EMAILS ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-slate-500 dark:text-white/40">E-mails</label>
                <button onClick={() => setEditForm(prev => ({ ...prev, emails: [...prev.emails, { id: Date.now().toString(), label: "Pessoal", value: "" }] }))} className="text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400 font-bold">+ Add E-mail</button>
              </div>
              <div className="space-y-2">
                {editForm.emails.map((e, idx) => (
                  <div key={e.id} className="flex gap-2 items-center">
                    <input placeholder="Rótulo" value={e.label} onChange={ev => setEditForm(prev => { const emails = [...prev.emails]; emails[idx] = { ...emails[idx], label: ev.target.value }; return { ...prev, emails }; })} className="w-20 p-2 border border-slate-200 dark:border-white/10 rounded-lg bg-white dark:bg-black/30 text-slate-800 dark:text-white text-xs font-bold" />
                    <input placeholder="email@exemplo.com" value={e.value} onChange={ev => setEditForm(prev => { const emails = [...prev.emails]; emails[idx] = { ...emails[idx], value: ev.target.value }; return { ...prev, emails }; })} className="flex-1 p-2 border border-slate-200 dark:border-white/10 rounded-lg bg-slate-50 dark:bg-black/20 text-slate-800 dark:text-white text-sm" />
                    <button onClick={() => setEditForm(prev => ({ ...prev, emails: prev.emails.filter(x => x.id !== e.id) }))} className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg"><IconTrash /></button>
                  </div>
                ))}
                {editForm.emails.length === 0 && <div className="text-xs text-slate-400 dark:text-white/30 italic">Nenhum e-mail.</div>}
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-white/10" />

            {/* ── GRUPOS ── */}
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5">Grupos / Marcadores (Google)</label>
              <input
                value={(editForm.labels || []).join(", ")}
                onChange={e => setEditForm({ ...editForm, labels: e.target.value.split(",").map(s => s.trim()).filter(s => s) })}
                className="w-full p-2.5 border border-slate-200 dark:border-white/10 rounded-lg bg-slate-50 dark:bg-black/20 text-slate-800 dark:text-white outline-none focus:border-amber-500 text-sm"
                placeholder="Ex: VIP, Família, Empresa"
              />
              {/* Tags clicáveis dos grupos existentes */}
              {uniqueLabels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {uniqueLabels.map(lbl => {
                    const active = editForm.labels.includes(lbl);
                    return (
                      <button
                        key={lbl}
                        onClick={() => setEditForm(prev => ({ ...prev, labels: active ? prev.labels.filter(l => l !== lbl) : [...prev.labels, lbl] }))}
                        className={`text-[10px] px-2 py-0.5 rounded font-bold border transition-colors ${active ? "bg-amber-500 text-white border-amber-500" : "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/50 border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10"}`}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Botões */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-white/10">
              <button onClick={() => setEditModal({ open: false, contact: null })} className="px-4 py-2 rounded-lg text-slate-500 dark:text-white/40 text-sm font-bold">Cancelar</button>
              <button onClick={handleSaveContact} disabled={isSaving} className="px-6 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-bold flex items-center gap-2 text-sm disabled:opacity-50">
                {isSaving ? "Salvando..." : "Salvar no Google"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL EXCLUSÃO ───────────────────────────────────────────────── */}
      {deleteModal.open && deleteModal.contact && (
        <Modal title="Excluir Contato" onClose={() => setDeleteModal({ open: false, contact: null })}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-white/70">Você está prestes a excluir o contato <strong>{deleteModal.contact.display_name}</strong>.</p>
            <label className="flex items-center gap-3 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg cursor-pointer">
              <input type="checkbox" checked={deleteFromGoogle} onChange={e => setDeleteFromGoogle(e.target.checked)} className="w-5 h-5 rounded border-rose-300 text-rose-600 focus:ring-rose-500" />
              <span className="text-sm font-bold text-rose-900 dark:text-rose-200">Excluir também da agenda do celular (Google Contacts)</span>
            </label>
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={() => setDeleteModal({ open: false, contact: null })} className="px-4 py-2 rounded-lg text-slate-500 dark:text-white/40 text-sm font-bold">Cancelar</button>
              <button onClick={handleDeleteContact} disabled={isDeleting} className="px-6 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-2 text-sm disabled:opacity-50">
                {isDeleting ? "Excluindo..." : "Confirmar Exclusão"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <div className="relative z-[999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

export default function AgendaPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400 animate-pulse">Carregando Agenda...</div>}>
      <AgendaPageContent />
    </Suspense>
  );
}

// ─── COMPONENTES VISUAIS ─────────────────────────────────────────────────────
const ALIGN_CLASS: Record<"left" | "right" | "center", string> = { left: "text-left", right: "text-right", center: "text-center" };
function Th({ children, width, align = "left" }: { children: React.ReactNode; width?: number; align?: "left" | "right" | "center" }) { return <th className={`px-3 py-2 ${ALIGN_CLASS[align]}`} style={{ width }}>{children}</th>; }
function ThSort({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) { return <th onClick={onClick} className="px-3 py-2 cursor-pointer select-none group hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors text-left"><div className="flex items-center gap-1">{label} <span className={`transition-opacity ${active ? "opacity-100 text-emerald-600" : "opacity-40 group-hover:opacity-70"}`}>{dir === "asc" ? <IconSortUp /> : <IconSortDown />}</span></div></th>; }
function SortClick({ label, onClick, active, dir }: { label: string; onClick: () => void; active: boolean; dir: SortDir }) { return <div onClick={onClick} className="inline-flex items-center justify-center gap-1 cursor-pointer select-none hover:text-emerald-500 transition-colors"><span className="font-bold uppercase text-xs tracking-wide">{label}</span><span className={`transition-opacity flex items-center ${active ? "opacity-100 text-emerald-600" : "opacity-30"}`}>{dir === "asc" ? <IconSortUp /> : <IconSortDown />}</span></div>; }
function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) { const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"; return <td className={`px-3 py-2 ${a} align-middle`}>{children}</td>; }

function IconActionBtn({ children, title, tone, onClick }: { children: React.ReactNode; title: string; tone: "blue" | "green" | "amber" | "purple" | "red"; onClick: (e: React.MouseEvent) => void }) {
  const colors = { blue: "text-sky-500 bg-sky-50 border-sky-200 hover:bg-sky-100 dark:bg-sky-500/10 dark:border-sky-500/20", green: "text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20", amber: "text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20", purple: "text-purple-600 bg-purple-50 border-purple-200 hover:bg-purple-100", red: "text-rose-600 bg-rose-50 border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:border-rose-500/20" };
  return <button onClick={e => { e.stopPropagation(); onClick(e); }} title={title} className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}>{children}</button>;
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="group w-full px-4 py-2.5 flex items-center gap-3 text-slate-600 dark:text-white/60 hover:bg-emerald-500/10 hover:text-emerald-600 transition-all text-left text-sm font-bold tracking-tight rounded-lg"><span className="opacity-70 group-hover:scale-110 transition-transform">{icon}</span>{label}</button>;
}

// Modal com dark mode corrigido — usa dark:bg-[#161b22] alinhado ao padrão do sistema
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "grid", placeItems: "center", zIndex: 99999, padding: 16 }}
    >
      <div onMouseDown={e => e.stopPropagation()} className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#1c2331]">
          <div className="font-bold text-slate-800 dark:text-white">{title}</div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/50"><IconX /></button>
        </div>
        <div className="p-4 bg-white dark:bg-[#161b22]">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// ─── ÍCONES ──────────────────────────────────────────────────────────────────
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconSortUp() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>; }
function IconSortDown() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>; }
function IconChat() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>; }
function IconSend() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></svg>; }
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" /></svg>; }
function IconSync() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21v-5h5" /></svg>; }
