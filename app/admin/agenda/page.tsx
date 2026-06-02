"use client";
import {
  Loader2,
  X,
  ChevronUp,
  ChevronDown,
  MessageCircle,
  Send,
  Pencil,
} from "lucide-react";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useSearchParams, useRouter } from "next/navigation";
import ToastNotifications, { ToastMessage } from "../ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

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
type EditPhone = {
  id: string;
  label: string;
  ddi: string;
  national: string;
  confirmed: boolean;
};
type EditEmail = { id: string; label: string; value: string };

// ─── DDI ─────────────────────────────────────────────────────────────────────
type DdiOption = { code: string; label: string; flag: string };

// ⚠️ IMPORTANTE: mantido sorted longest-to-shortest igual ao padrão do sistema
const DDI_OPTIONS: DdiOption[] = [
  { code: "55", label: "Brasil", flag: "🇧🇷" },
  { code: "1", label: "EUA/Canadá", flag: "🇺🇸" },
  { code: "351", label: "Portugal", flag: "🇵🇹" },
  { code: "353", label: "Irlanda", flag: "🇮🇪" },
  { code: "507", label: "Panamá", flag: "🇵🇦" },
  { code: "506", label: "Costa Rica", flag: "🇨🇷" },
  { code: "595", label: "Paraguai", flag: "🇵🇾" },
  { code: "591", label: "Bolívia", flag: "🇧🇴" },
  { code: "234", label: "Nigéria", flag: "🇳🇬" },
  { code: "254", label: "Quênia", flag: "🇰🇪" },
  { code: "212", label: "Marrocos", flag: "🇲🇦" },
  { code: "971", label: "Emirados Árabes", flag: "🇦🇪" },
  { code: "966", label: "Arábia Saudita", flag: "🇸🇦" },
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
  { code: "32", label: "Bélgica", flag: "🇧🇪" },
  { code: "46", label: "Suécia", flag: "🇸🇪" },
  { code: "31", label: "Holanda", flag: "🇳🇱" },
  { code: "41", label: "Suíça", flag: "🇨🇭" },
  { code: "45", label: "Dinamarca", flag: "🇩🇰" },
  { code: "48", label: "Polônia", flag: "🇵🇱" },
  { code: "30", label: "Grécia", flag: "🇬🇷" },
  { code: "27", label: "África do Sul", flag: "🇿🇦" },
  { code: "20", label: "Egito", flag: "🇪🇬" },
  { code: "86", label: "China", flag: "🇨🇳" },
  { code: "91", label: "Índia", flag: "🇮🇳" },
  { code: "81", label: "Japão", flag: "🇯🇵" },
  { code: "82", label: "Coreia do Sul", flag: "🇰🇷" },
  { code: "66", label: "Tailândia", flag: "🇹🇭" },
  { code: "62", label: "Indonésia", flag: "🇮🇩" },
  { code: "60", label: "Malásia", flag: "🇲🇾" },
  { code: "98", label: "Irã", flag: "🇮🇷" },
  { code: "90", label: "Turquia", flag: "🇹🇷" },
  { code: "61", label: "Austrália", flag: "🇦🇺" },
  { code: "64", label: "Nova Zelândia", flag: "🇳🇿" },
];

function onlyDigits(raw: string) {
  return (raw || "").replace(/\D+/g, "");
}

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
    if (rest.length === 9)
      return `${area} ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8)
      return `${area} ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `${area} ${rest}`.trim();
  }
  // Genérico: agrupa em blocos
  const groups: string[] = [];
  let i = 0;
  while (i < d.length) {
    const step = d.length - i > 7 ? 3 : 4;
    groups.push(d.slice(i, i + step));
    i += step;
  }
  return groups.join(" ").trim();
}

// 🌟 NOVA função central de exibição:
// Brasil  → (021) 99999-8888
// Outros  → 🇵🇹 +351 XXX XXX XXX
function displayPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = onlyDigits(raw);
  if (!digits) return raw || "";

  const hasPlus = raw.trim().startsWith("+");
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
    if (rest.length === 9)
      return `(0${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8)
      return `(0${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `(0${ddd}) ${rest}`.trim();
  }

  const opt = DDI_OPTIONS.find((o) => o.code === ddi);
  const flag = opt?.flag || "🌐";
  return `${flag} +${ddi} ${formatNational(ddi, national)}`;
}

// Converte um phone raw (ex: "+5521999998888" ou "21999998888") para EditPhone
function parsePhoneToEditPhone(
  raw: string,
  label: string,
  id: string,
): EditPhone {
  const digits = onlyDigits(raw);
  if (!digits) return { id, label, ddi: "55", national: "", confirmed: false };
  let ddi = "55";
  let national = digits;
  if (digits.length > 11 || raw.trim().startsWith("+")) {
    ddi = inferDDI(digits);
    national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
  }
  return {
    id,
    label,
    ddi,
    national: formatNational(ddi, national) || national,
    confirmed: true,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function compareText(a: string, b: string) {
  return (a || "").localeCompare(b || "", "pt-BR", { sensitivity: "base" });
}

function formatBirthday(b: string | null) {
  if (!b) return "—";
  const parts = b.split("-");
  if (parts.length >= 3)
    return `${parts[parts.length - 1]}/${parts[parts.length - 2]}`;
  return b;
}

function getBirthdayMonth(b: string | null): number | null {
  if (!b) return null;
  const parts = b.split("-");
  if (parts.length >= 2) {
    const m = parseInt(parts[parts.length - 2], 10);
    return isNaN(m) ? null : m;
  }
  return null;
}

function getPhonesArray(
  contact: GoogleContact,
): { id: string; label: string; value: string }[] {
  if (
    contact.phones &&
    Array.isArray(contact.phones) &&
    contact.phones.length > 0
  ) {
    return contact.phones.map((p, i) => ({
      id: i.toString(),
      label: p.label || "Celular",
      value: p.value,
    }));
  }
  const arr = [];
  if (contact.phone_e164)
    arr.push({ id: "old1", label: "Celular", value: contact.phone_e164 });
  if (contact.secondary_phone)
    arr.push({ id: "old2", label: "Telefone", value: contact.secondary_phone });
  return arr;
}

function getEmailsArray(
  contact: GoogleContact,
): { id: string; label: string; value: string }[] {
  if (
    contact.emails &&
    Array.isArray(contact.emails) &&
    contact.emails.length > 0
  ) {
    return contact.emails.map((e, i) => ({
      id: i.toString(),
      label: e.label || "Pessoal",
      value: e.value,
    }));
  }
  if (contact.email)
    return [{ id: "old1", label: "Pessoal", value: contact.email }];
  return [];
}

const MONTH_NAMES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

// ─── PAGE ────────────────────────────────────────────────────────────────────
function AgendaPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // 👇 Ativando o nosso confirm customizado
  const { confirm, ConfirmUI } = useConfirm();

  const [rows, setRows] = useState<GoogleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState("Todos");
  const [emailLabelFilter, setEmailLabelFilter] = useState("Todos");
  const [phoneLabelFilter, setPhoneLabelFilter] = useState("Todos");
  const [photoFilter, setPhotoFilter] = useState("Todos"); // <--- NOVO: Filtro de foto
  const [pageSize, setPageSize] = useState(30);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  // Adiciona junto aos outros states:
  const [showGroupPopover, setShowGroupPopover] = useState(false);
  const [newGroupInput, setNewGroupInput] = useState("");
  const [isAssigningGroup, setIsAssigningGroup] = useState(false);

  const uniqueLabels = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => r.labels || []))).sort(),
    [rows],
  );
  const uniqueEmailLabels = useMemo(
    () =>
      Array.from(
        new Set(rows.flatMap((r) => getEmailsArray(r).map((e) => e.label))),
      ).sort(),
    [rows],
  );

  // <--- ADICIONADO: Extrai os nomes únicos das operadoras/labels de telefone
  const uniquePhoneLabels = useMemo(
    () =>
      Array.from(
        new Set(rows.flatMap((r) => getPhonesArray(r).map((p) => p.label))),
      ).sort(),
    [rows],
  );

  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const hasActiveFilters =
    labelFilter !== "Todos" ||
    emailLabelFilter !== "Todos" ||
    phoneLabelFilter !== "Todos" ||
    photoFilter !== "Todos"; // <--- ATUALIZADO

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>(
    {},
  );

  function addToast(
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
  ) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    if (toastTimersRef.current[id]) clearTimeout(toastTimersRef.current[id]);
    toastTimersRef.current[id] = setTimeout(() => removeToast(id), 5000);
  }
  function removeToast(id: number) {
    if (toastTimersRef.current[id]) {
      clearTimeout(toastTimersRef.current[id]);
      delete toastTimersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Msg menu / Send
  const [msgMenuForId, setMsgMenuForId] = useState<string | null>(null);
  const [showSendNow, setShowSendNow] = useState<{
    open: boolean;
    contactId: string | null;
    phone: string | null;
  }>({ open: false, contactId: null, phone: null });
  const [messageText, setMessageText] = useState("");
  const [sendingNow, setSendingNow] = useState(false);
  const [sessionOptions, setSessionOptions] = useState<
    { id: string; label: string }[]
  >([{ id: "default", label: "Carregando..." }]);
  const [selectedSessionNow, setSelectedSessionNow] = useState("default");

  // Edit modal
  const [editModal, setEditModal] = useState<{
    open: boolean;
    contact: GoogleContact | null;
  }>({ open: false, contact: null });
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
  type WaValidation = {
    loading?: boolean;
    exists?: boolean;
    jid?: string;
    photoStatus?: "loading" | "synced" | "protected" | null;
    opLoading?: boolean;
    opName?: string;
    opError?: boolean;
  } | null;
  const [waValidations, setWaValidations] = useState<
    Record<string, WaValidation>
  >({});
  const waTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  async function validateWaForPhone(
    phoneId: string,
    e164: string,
    autoSyncContactId?: string,
  ) {
    const digits = onlyDigits(e164);
    if (digits.length < 8) {
      setWaValidations((prev) => {
        const n = { ...prev };
        delete n[phoneId];
        return n;
      });
      return;
    }
    // Preserva o estado anterior e ativa SÓ o loading do WA
    setWaValidations((prev) => ({
      ...prev,
      [phoneId]: { ...(prev[phoneId] || {}), loading: true },
    }));

    try {
      const res = await fetch("/api/whatsapp/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const json = await res.json().catch(() => ({}));

      // Preserva o estado anterior e atualiza SÓ o status do WA
      setWaValidations((prev) => ({
        ...prev,
        [phoneId]: {
          ...(prev[phoneId] || {}),
          loading: false,
          exists: !!json.exists,
          jid: json.jid,
        },
      }));

      // Auto-sync foto se WA ativo e contactId fornecido
      if (json.exists && json.jid && autoSyncContactId) {
        setTimeout(
          () => handleSyncWaPhotoSilent(autoSyncContactId, json.jid, phoneId),
          300,
        );
      }
    } catch {
      setWaValidations((prev) => ({
        ...prev,
        [phoneId]: { ...(prev[phoneId] || {}), loading: false, exists: false },
      }));
    }
  }

  // Delete modal
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    contact: GoogleContact | null;
  }>({ open: false, contact: null });
  const [deleteFromGoogle, setDeleteFromGoogle] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSyncingLabels, setIsSyncingLabels] = useState(false);
  const [isSyncingOperadora, setIsSyncingOperadora] = useState(false); // <--- ADICIONADO

  // ─── UTILS ─────────────────────────────────────────────────────────────────
  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleMassSyncOperadora() {
    if (selectedIds.size === 0) return;
    setIsSyncingOperadora(true);
    try {
      const res = await fetch("/api/auth/google/sync-operadora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_ids: Array.from(selectedIds) }),
      });
      const data = await res.json();

      if (res.ok) {
        addToast("success", "Operadoras Atualizadas", data.message);
        if (data.errors?.length)
          addToast(
            "warning",
            "Alguns erros",
            data.errors.slice(0, 3).join(" | "),
          );
        loadData();
        setSelectedIds(new Set());
      } else {
        throw new Error(data.error || "Erro ao consultar.");
      }
    } catch (err: any) {
      addToast("error", "Erro", err.message);
    } finally {
      setIsSyncingOperadora(false);
    }
  }

  const [isPushingGoogle, setIsPushingGoogle] = useState(false);

  // Reenvia o que JÁ ESTÁ no Supabase pro Google (nome, telefones+operadora,
  // emails, labels/grupos). NÃO consulta a Telein — zero gasto de crédito.
  // Processa em chunks pra caber no teto de 10s da Vercel grátis.
  async function handleMassPushGoogle() {
    if (selectedIds.size === 0) return;
    setIsPushingGoogle(true);
    const ids = Array.from(selectedIds);
    const CHUNK = 10;
    let totalUpdated = 0;
    const allErrors: string[] = [];

    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const res = await fetch("/api/auth/google/push-to-google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_ids: slice }),
        });
        const data = await res.json();
        if (res.ok) {
          totalUpdated += data.updated || 0;
          if (data.errors?.length) allErrors.push(...data.errors);
        } else {
          allErrors.push(data.error || "Erro no lote.");
        }
      }

      addToast(
        "success",
        "Reenvio concluído",
        `${totalUpdated} contato(s) reenviado(s) ao Google.`,
      );
      if (allErrors.length)
        addToast("warning", "Alguns erros", allErrors.slice(0, 3).join(" | "));
      loadData();
      setSelectedIds(new Set());
    } catch (err: any) {
      addToast("error", "Erro", err.message);
    } finally {
      setIsPushingGoogle(false);
    }
  }

  async function handleMassAssignGroup(label: string) {
    if (!label.trim() || selectedIds.size === 0) return;
    setIsAssigningGroup(true);
    setShowGroupPopover(false);
    setNewGroupInput("");
    try {
      const res = await fetch("/api/auth/google/bulk-add-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_ids: Array.from(selectedIds),
          label: label.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast("success", "Grupo atribuído", data.message);
        if (data.errors?.length)
          addToast(
            "warning",
            "Alguns erros",
            data.errors.slice(0, 3).join(" | "),
          );
        loadData();
      } else {
        addToast("error", "Erro ao atribuir grupo", data.error);
      }
    } catch (err: any) {
      addToast("error", "Erro", err.message);
    } finally {
      setIsAssigningGroup(false);
    }
  }

  // ─── EFEITOS ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const syncStatus = searchParams.get("sync");
    const syncCount = searchParams.get("count");
    if (syncStatus === "success") {
      addToast(
        "success",
        "Sincronização concluída",
        `${syncCount} contatos importados do Google.`,
      );
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
      const { data, error } = await supabaseBrowser
        .from("google_contacts")
        .select("*")
        .eq("tenant_id", tid);
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
      const res = await fetch("/api/whatsapp/status")
        .then((r) => r.json())
        .catch(() => ({}));
      setSessionOptions([
        {
          id: "default",
          label: res.connected
            ? "Contato Principal (Conectado)"
            : "Contato Principal (Desconectado)",
        },
      ]);
    } catch {
      setSessionOptions([{ id: "default", label: "Sessão Padrão" }]);
    }
  }

  // ─── FILTROS & ORDENAÇÃO ───────────────────────────────────────────────────
  // Reseta a seleção ao trocar de página OU mudar qualquer filtro,
  // pra cada página ser um lote independente (sem seleção "fantasma").
  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, labelFilter, emailLabelFilter, phoneLabelFilter, photoFilter, page, pageSize]);

  const filtered = useMemo(() => {
    const q = search
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return rows.filter((r) => {
      // 1. Filtro de Grupo
      if (labelFilter === "__SEM_GRUPO__") {
        const realLabels = (r.labels || []).filter(
          (l) => l && l.trim().length > 0,
        );
        if (realLabels.length > 0) return false;
      } else if (labelFilter !== "Todos") {
        if (!r.labels || !r.labels.includes(labelFilter)) return false;
      }

      // 2. Filtro de E-mail
      if (emailLabelFilter !== "Todos") {
        const eLbls = getEmailsArray(r).map((e) => e.label);
        if (!eLbls.includes(emailLabelFilter)) return false;
      }

      // 3. Filtro de Operadora
      if (phoneLabelFilter !== "Todos") {
        const pLbls = getPhonesArray(r).map((p) => p.label);
        if (!pLbls.includes(phoneLabelFilter)) return false;
      }

      // 4. Filtro de Foto (Aprimorado)
      const avatar = r.avatar_url || "";

      // Identifica as bolinhas coloridas (geradas sob o caminho /cm/) e outros padrões vazios do Google
      const isFakePhoto =
        avatar === "" ||
        avatar.includes("/cm/") ||
        avatar.includes("default-user") ||
        avatar.includes("AAAAAAAAAAA") ||
        avatar.includes("silhouette");

      if (photoFilter === "ComFoto" && isFakePhoto) return false;
      if (photoFilter === "SemFoto" && !isFakePhoto) return false;

      // 5. Filtro de Busca por texto
      if (q) {
        const hay = [
          r.display_name,
          getPhonesArray(r)
            .map((p) => p.value)
            .join(" "),
          getEmailsArray(r)
            .map((e) => e.value)
            .join(" "),
          ...(r.labels || []),
        ]
          .join(" ")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }

      return true;
    });
    // 👇 AQUI ESTÁ O SEGREDO: O "photoFilter" precisa estar nesta lista final!
  }, [
    rows,
    search,
    labelFilter,
    emailLabelFilter,
    phoneLabelFilter,
    photoFilter,
  ]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name")
        cmp = compareText(a.display_name || "", b.display_name || "");
      else if (sortKey === "birthday")
        cmp = compareText(a.birthday || "", b.birthday || "");
      else if (sortKey === "labels")
        cmp = compareText((a.labels || []).join(""), (b.labels || []).join(""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function setAllVisible(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        visible.forEach((r) => next.add(r.id));
      } else {
        visible.forEach((r) => next.delete(r.id));
      }
      return next;
    });
  }

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const total = visible.length;
    const sel = visible.filter((r) => selectedIds.has(r.id)).length;
    el.indeterminate = sel > 0 && sel < total;
  }, [selectedIds, visible]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(nextKey);
      setSortDir("asc");
    }
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
        body: JSON.stringify({
          tenant_id: tenantId,
          phone_e164: showSendNow.phone,
          message: msg,
          whatsapp_session: selectedSessionNow,
        }),
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
    const ok = await confirm({
      title: "Importar do Google?",
      subtitle:
        "Isso apagará a lista atual do sistema. Sua agenda ficará idêntica ao seu Google Contacts.",
      tone: "amber",
      confirmText: "Sim, importar",
      cancelText: "Cancelar",
    });

    if (!ok) return;

    setLoading(true);
    try {
      // Passamos um parâmetro ?mode=replace para a API saber que é uma importação destrutiva
      const res = await fetch("/api/auth/google/sync-silent?mode=replace", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        addToast(
          "success",
          "Importação concluída",
          `${data.count} contatos importados do Google.`,
        );
        loadData();
      } else {
        addToast(
          "warning",
          "Acesso necessário",
          "Redirecionando para o Google...",
        );
        window.location.href = "/api/auth/google";
      }
    } catch (err: any) {
      addToast("error", "Erro ao importar", err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncLabels() {
    setIsSyncingLabels(true);
    try {
      const res = await fetch("/api/auth/google/sync-labels-from-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_ids: selectedIds.size > 0 ? Array.from(selectedIds) : null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast("success", "Vinculação concluída", data.message);
        if (data.errors?.length)
          addToast(
            "warning",
            "Alguns erros",
            data.errors.slice(0, 3).join(" | "),
          );
        loadData();
      } else {
        addToast("error", "Erro ao vincular", data.error);
      }
    } catch (err: any) {
      addToast("error", "Erro", err.message);
    } finally {
      setIsSyncingLabels(false);
    }
  }

  const [isSyncingPhotos, setIsSyncingPhotos] = useState(false);
  // Busca a operadora on the fly para o modal de edição
  async function lookupOperadoraForPhone(
    phoneId: string,
    ddi: string,
    digits: string,
  ) {
    if (digits.length < 5) return;

    // 1. Ativa o loading visual da operadora SEM sobrescrever o WA com false
    setWaValidations((prev) => ({
      ...prev,
      [phoneId]: { ...(prev[phoneId] || {}), opLoading: true, opError: false },
    }));
    try {
      const res = await fetch("/api/auth/google/lookup-operadora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: `${ddi}${digits}` }),
      });

      if (!res.ok) throw new Error("Erro na API");
      const data = await res.json();

      if (data.operadora) {
        // Atualiza o label no formulário
        setEditForm((prev) => {
          const phones = [...prev.phones];
          const index = phones.findIndex((x) => x.id === phoneId);
          if (index > -1)
            phones[index] = { ...phones[index], label: data.operadora };
          return { ...prev, phones };
        });
        // Sucesso
        setWaValidations((prev) => ({
          ...prev,
          [phoneId]: {
            ...prev[phoneId]!,
            opLoading: false,
            opName: data.operadora,
            opError: false,
          },
        }));
      } else {
        // Falha (não encontrou operadora)
        setWaValidations((prev) => ({
          ...prev,
          [phoneId]: { ...prev[phoneId]!, opLoading: false, opError: true },
        }));
      }
    } catch (e) {
      // Falha (erro na requisição)
      setWaValidations((prev) => ({
        ...prev,
        [phoneId]: { ...prev[phoneId]!, opLoading: false, opError: true },
      }));
    }
  }

  async function handleMassSyncPhotos() {
    if (selectedIds.size === 0) return;
    setIsSyncingPhotos(true);
    let synced = 0,
      failed = 0;
    const failReasons: string[] = [];
    const selectedContacts = rows.filter((r) => selectedIds.has(r.id));

    for (const contact of selectedContacts) {
      const phones = getPhonesArray(contact);
      if (!phones.length) continue;
      try {
        const digits = onlyDigits(phones[0].value);
        if (digits.length < 8) continue;
        const vRes = await fetch("/api/whatsapp/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: digits }),
        });
        const vData = await vRes.json().catch(() => ({}));
        if (!vData.exists || !vData.jid) continue;

        const pRes = await fetch("/api/whatsapp/contact-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_id: contact.id, jid: vData.jid }),
        });
        if (pRes.ok) {
          synced++;
        } else {
          const errData = await pRes.json().catch(() => ({}));
          failed++;
          failReasons.push(errData.error || "erro desconhecido");
        }
        await new Promise((r) => setTimeout(r, 500)); // mais seguro para massa
      } catch {
        failed++;
      }
    }

    addToast(
      "success",
      "Fotos sincronizadas",
      `${synced} atualizada(s)${failed > 0 ? `, ${failed} falharam${failReasons[0] ? ` (${failReasons[0]})` : ""}` : ""}.`,
    );
    setIsSyncingPhotos(false);
    loadData();
  }

  // ─── MODAL EDIT ────────────────────────────────────────────────────────────
  function openEditModal(contact: GoogleContact) {
    const phones = getPhonesArray(contact).map((p) =>
      parsePhoneToEditPhone(p.value, p.label, p.id),
    );
    const emails = getEmailsArray(contact).map((e) => ({ ...e }));
    setEditForm({
      display_name: contact.display_name || "",
      phones,
      emails,
      labels: contact.labels || [],
      new_photo_base64: undefined,
    });
    setWaValidations({});
    setEditModal({ open: true, contact });
  }

  function openCreateModal() {
    setEditForm({
      display_name: "",
      phones: [
        {
          id: Date.now().toString(),
          label: "Celular",
          ddi: "55",
          national: "",
          confirmed: false,
        },
      ],
      emails: [],
      labels: [],
      new_photo_base64: undefined,
    });
    setWaValidations({});
    setEditModal({ open: true, contact: null });
  }

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () =>
        setEditForm((prev) => ({
          ...prev,
          new_photo_base64: reader.result as string,
        }));
      reader.readAsDataURL(file);
    }
  };

  // Confirma e normaliza um telefone do modal, e dispara APENAS a validação de Operadora
  function confirmPhone(idx: number) {
    setEditForm((prev) => {
      const phones = [...prev.phones];
      const p = phones[idx];
      let digits = onlyDigits(p.national);

      // Strip zero inicial para Brasil (ex: "021..." → "21...")
      if (p.ddi === "55" && digits.startsWith("0")) digits = digits.slice(1);
      if (digits.length < 8) {
        phones[idx] = { ...p, confirmed: false };
        return { ...prev, phones };
      }

      let ddi = p.ddi;
      let national = digits;
      if (digits.length > 11) {
        ddi = inferDDI(digits);
        national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
      }
      const formatted = formatNational(ddi, national);
      phones[idx] = {
        ...p,
        ddi,
        national: formatted || national,
        confirmed: true,
      };

      // Dispara APENAS a validação de Operadora/País com debounce
      const cleanNational = onlyDigits(formatted || national);
      if (waTimers.current[p.id]) clearTimeout(waTimers.current[p.id]);

      waTimers.current[p.id] = setTimeout(() => {
        lookupOperadoraForPhone(p.id, ddi, cleanNational); // 🚀 CHAMA A OPERADORA
      }, 400);

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
        addToast(
          "success",
          "Foto atualizada",
          "Foto do WhatsApp sincronizada com sucesso.",
        );
        loadData();
        setEditModal((prev) => ({
          ...prev,
          contact: prev.contact
            ? { ...prev.contact, avatar_url: data.avatar_url }
            : null,
        }));
      } else {
        addToast(
          "warning",
          "Foto protegida",
          "Este contato tem a foto privada no WhatsApp.",
        );
      }
    } catch {
      addToast(
        "error",
        "Erro",
        "Rota /api/whatsapp/contact-photo ainda não implementada na VM.",
      );
    }
  }

  async function handleSyncWaPhotoSilent(
    contactId: string,
    jid: string,
    phoneId?: string,
  ) {
    if (phoneId)
      setWaValidations((prev) => ({
        ...prev,
        [phoneId]: { ...prev[phoneId]!, photoStatus: "loading" },
      }));
    try {
      const res = await fetch("/api/whatsapp/contact-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, jid }),
      });
      const data = await res.json();
      if (res.ok && data.avatar_url) {
        if (phoneId)
          setWaValidations((prev) => ({
            ...prev,
            [phoneId]: { ...prev[phoneId]!, photoStatus: "synced" },
          }));
        setEditModal((prev) => ({
          ...prev,
          contact: prev.contact
            ? { ...prev.contact, avatar_url: data.avatar_url }
            : null,
        }));
        loadData();
      } else {
        if (phoneId)
          setWaValidations((prev) => ({
            ...prev,
            [phoneId]: { ...prev[phoneId]!, photoStatus: "protected" },
          }));
      }
    } catch {
      if (phoneId)
        setWaValidations((prev) => ({
          ...prev,
          [phoneId]: { ...prev[phoneId]!, photoStatus: "protected" },
        }));
    }
  }

  async function handleSaveContact() {
    setIsSaving(true);
    try {
      const isNew = !editModal.contact;
      const endpoint = isNew
        ? "/api/auth/google/create"
        : "/api/auth/google/update";

      // Reconstrói os phones com e164 completo para o backend
      const phones = editForm.phones
        .filter((p) => p.national.trim())
        .map((p) => ({
          label: p.label,
          value: `+${p.ddi}${onlyDigits(p.national)}`,
        }));

      const payload = {
        id: editModal.contact?.id,
        google_resource_name: editModal.contact?.google_resource_name,
        display_name: editForm.display_name,
        phones,
        emails: editForm.emails.map((e) => ({
          label: e.label,
          value: e.value,
        })),
        labels: editForm.labels,
        photo_base64: editForm.new_photo_base64,
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Erro ao salvar.");
      }
      addToast(
        "success",
        "Salvo",
        `Contato ${isNew ? "criado" : "atualizado"} com sucesso.`,
      );
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
        body: JSON.stringify({
          id: deleteModal.contact.id,
          resourceName: deleteModal.contact.google_resource_name,
          deleteFromGoogle,
        }),
      });
      if (!res.ok) throw new Error("Erro ao excluir.");
      addToast(
        "success",
        "Excluído",
        `Contato removido${deleteFromGoogle ? " do sistema e do Google" : " apenas do sistema"}.`,
      );
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
      className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-background transition-colors"
      onClick={() => {
        setMsgMenuForId(null);
        setShowGroupPopover(false);
      }}
    >
      {/* HEADER */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
              Agenda
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1.5 justify-end shrink-0">
          <button
            onClick={openCreateModal}
            className="h-8 md:h-10 px-2.5 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] md:text-sm flex items-center gap-1.5 shadow-lg shadow-emerald-900/20 transition-all whitespace-nowrap"
          >
            + Novo Contato
          </button>
          <button
            onClick={handleSilentSync}
            disabled={loading}
            className="h-8 md:h-10 px-2.5 md:px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-[11px] md:text-sm flex items-center gap-1.5 shadow-lg shadow-blue-900/20 transition-all disabled:opacity-50 whitespace-nowrap"
          >
            <IconSync /> Importar Google
          </button>
        </div>
      </div>

      {/* FILTROS */}
      <div className="px-3 md:p-4 bg-transparent md:bg-white md:dark:bg-card border-0 md:border md:border-slate-200 md:dark:border-border rounded-none md:rounded-xl shadow-none md:shadow-sm mb-4 z-20">
        {/* UMA linha no desktop, busca + botão filtros no mobile */}
        <div className="flex gap-2 items-center">
          <div className="flex-1">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Pesquisar por nome, telefone ou email..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-lg text-sm outline-none text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20"
            />
          </div>

          {/* Filtros inline — visíveis só no desktop */}
          <div className="hidden md:flex items-center gap-2">
            <select
              value={labelFilter}
              onChange={(e) => {
                setLabelFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-lg text-sm text-slate-600 dark:text-white"
            >
              <option value="Todos">Grupo (Todos)</option>
              <option value="__SEM_GRUPO__">Sem grupo</option>
              {uniqueLabels.map((lbl) => (
                <option key={lbl} value={lbl}>
                  {lbl}
                </option>
              ))}
            </select>

            <select
              value={emailLabelFilter}
              onChange={(e) => {
                setEmailLabelFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-lg text-sm text-slate-600 dark:text-white"
            >
              <option value="Todos">📧 E-mail (Todos)</option>
              {uniqueEmailLabels.map((lbl) => (
                <option key={lbl} value={lbl}>
                  {lbl}
                </option>
              ))}
            </select>

            {/* <--- ADICIONADO: Filtro Operadora (Desktop) */}
            <select
              value={phoneLabelFilter}
              onChange={(e) => {
                setPhoneLabelFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-lg text-sm text-slate-600 dark:text-white"
            >
              <option value="Todos">📱 Operadora (Todas)</option>
              {uniquePhoneLabels.map((lbl) => (
                <option key={lbl} value={lbl}>
                  {lbl}
                </option>
              ))}
            </select>

            {/* <--- NOVO: Filtro de Foto (Desktop) */}
            <select
              value={photoFilter}
              onChange={(e) => {
                setPhotoFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-lg text-sm text-slate-600 dark:text-white"
            >
              <option value="Todos">📷 Foto (Todas)</option>
              <option value="ComFoto">Com foto</option>
              <option value="SemFoto">Sem foto</option>
            </select>

            {hasActiveFilters && (
              <button
                onClick={() => {
                  setLabelFilter("Todos");
                  setEmailLabelFilter("Todos");
                  setPhoneLabelFilter("Todos");
                  setPhotoFilter("Todos");
                  setPage(1);
                }} // <--- ATUALIZADO
                className="h-10 px-3 rounded-lg text-xs font-medium text-rose-500 border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors whitespace-nowrap"
              >
                ✕ Limpar
              </button>
            )}
          </div>

          {/* Botão filtros — só no mobile */}
          <button
            onClick={() => setShowMobileFilters((v) => !v)}
            className={`md:hidden h-10 px-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-1.5 ${
              hasActiveFilters
                ? "bg-amber-500 text-white border-amber-500"
                : "bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-border text-slate-600 dark:text-white"
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M3 6h18M7 12h10M11 18h2" />
            </svg>
            {hasActiveFilters ? "Filtros ●" : "Filtros"}
          </button>
        </div>

        {/* Painel expandido no mobile */}
        {showMobileFilters && (
          <div className="md:hidden flex flex-col gap-2 mt-2 animate-in slide-in-from-top-2">
            <select
              value={labelFilter}
              onChange={(e) => {
                setLabelFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-lg text-sm text-slate-600 dark:text-white"
            >
              <option value="Todos">Grupo (Todos)</option>
              <option value="__SEM_GRUPO__">Sem grupo</option>
              {uniqueLabels.map((lbl) => (
                <option key={lbl} value={lbl}>
                  {lbl}
                </option>
              ))}
            </select>

            <select
              value={emailLabelFilter}
              onChange={(e) => {
                setEmailLabelFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-lg text-sm text-slate-600 dark:text-white"
            >
              <option value="Todos">📧 E-mail (Todos)</option>
              {uniqueEmailLabels.map((lbl) => (
                <option key={lbl} value={lbl}>
                  {lbl}
                </option>
              ))}
            </select>

            {/* <--- ADICIONADO: Filtro Operadora no Mobile */}
            <select
              value={phoneLabelFilter}
              onChange={(e) => {
                setPhoneLabelFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-lg text-sm text-slate-600 dark:text-white"
            >
              <option value="Todos">📱 Operadora (Todas)</option>
              {uniquePhoneLabels.map((lbl) => (
                <option key={lbl} value={lbl}>
                  {lbl}
                </option>
              ))}
            </select>

            {/* <--- NOVO: Filtro de Foto no Mobile */}
            <select
              value={photoFilter}
              onChange={(e) => {
                setPhotoFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-lg text-sm text-slate-600 dark:text-white"
            >
              <option value="Todos">📷 Foto (Todas)</option>
              <option value="ComFoto">Com foto</option>
              <option value="SemFoto">Sem foto</option>
            </select>

            {hasActiveFilters && (
              <button
                onClick={() => {
                  setLabelFilter("Todos");
                  setEmailLabelFilter("Todos");
                  setPhoneLabelFilter("Todos");
                  setPhotoFilter("Todos");
                  setPage(1);
                }} // <--- ATUALIZADO
                className="h-10 px-3 rounded-lg text-sm font-medium text-rose-500 border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10"
              >
                ✕ Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* SELEÇÃO EM MASSA */}
      {selectedIds.size > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-500/30 rounded-xl mb-4 animate-in slide-in-from-top-2 mx-3 sm:mx-0"
        >
          <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
            {selectedIds.size} contato(s) selecionado(s)
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMassPushGoogle}
              disabled={isPushingGoogle}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {isPushingGoogle ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Reenviando ao Google...
                </>
              ) : (
                <>📤 Reenviar Google ({selectedIds.size})</>
              )}
            </button>
            <button
              onClick={handleMassSyncOperadora}
              disabled={isSyncingOperadora}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSyncingOperadora ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sincronizando operadora...
                </>
              ) : (
                <>🔄 Operadora ({selectedIds.size})</>
              )}
            </button>
            <button
              onClick={handleMassSyncPhotos}
              disabled={isSyncingPhotos}
              className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSyncingPhotos ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sincronizando fotos...
                </>
              ) : (
                <>🔄 Fotos ({selectedIds.size})</>
              )}
            </button>
            <button
              onClick={handleSyncLabels}
              disabled={isSyncingLabels}
              className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSyncingLabels ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sincronizando servidor...
                </>
              ) : (
                <>🔄 Servidor ({selectedIds.size})</>
              )}
            </button>
            {/* NOVO: Atribuir Grupo */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowGroupPopover((v) => !v);
                }}
                disabled={isAssigningGroup}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {isAssigningGroup ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sincronizando grupos...
                  </>
                ) : (
                  <>🔄 Grupo</>
                )}
              </button>

              {showGroupPopover && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl shadow-2xl z-50 p-3 space-y-2"
                >
                  <p className="text-[11px] font-medium text-slate-500 dark:text-muted-foreground uppercase tracking-wide">
                    Grupos existentes
                  </p>
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                    {uniqueLabels
                      .filter((l) => l && l.trim())
                      .map((lbl) => (
                        <button
                          key={lbl}
                          onClick={() => handleMassAssignGroup(lbl)}
                          className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-muted-foreground border border-slate-200 dark:border-border hover:bg-amber-500 hover:text-white hover:border-amber-500 transition-colors"
                        >
                          {lbl}
                        </button>
                      ))}
                  </div>
                  <div className="border-t border-slate-200 dark:border-border pt-2">
                    <p className="text-[11px] font-medium text-slate-500 dark:text-muted-foreground uppercase tracking-wide mb-1.5">
                      Novo grupo
                    </p>
                    <div className="flex gap-1.5">
                      <input
                        value={newGroupInput}
                        onChange={(e) => setNewGroupInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newGroupInput.trim())
                            handleMassAssignGroup(newGroupInput);
                        }}
                        placeholder="Nome do grupo..."
                        className="flex-1 h-8 px-2 text-xs border border-slate-200 dark:border-border rounded-lg bg-slate-50 dark:bg-black/20 text-slate-800 dark:text-white outline-none focus:border-amber-500"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          if (newGroupInput.trim())
                            handleMassAssignGroup(newGroupInput);
                        }}
                        disabled={!newGroupInput.trim()}
                        className="h-8 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-medium disabled:opacity-40 transition-colors"
                      >
                        OK
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TABELA */}
      {!loading && (
        <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0">
          <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-slate-200 dark:border-border bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-medium tracking-tight text-slate-800 dark:text-white whitespace-nowrap">
              Lista de Contatos{" "}
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                {filtered.length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px] table-fixed">
              <thead>
                <tr className="border-b border-slate-200 dark:border-border text-xs font-medium uppercase text-slate-500 dark:text-white/55">
                  <Th width={36}>
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={
                        visible.length > 0 &&
                        visible.every((r) => selectedIds.has(r.id))
                      }
                      onChange={(e) => setAllVisible(e.target.checked)}
                      className="rounded border-slate-300 dark:border-white/20 bg-slate-100 dark:bg-white/5 cursor-pointer"
                    />
                  </Th>
                  <ThSort
                    label="Contato"
                    active={sortKey === "name"}
                    dir={sortDir}
                    onClick={() => toggleSort("name")}
                    width={200}
                  />
                  <Th width={220}>Telefones</Th>
                  <Th width={220}>E-mails</Th>
                  <Th width={120} align="center">
                    <SortClick
                      label="Grupo"
                      active={sortKey === "labels"}
                      dir={sortDir}
                      onClick={() => toggleSort("labels")}
                    />
                  </Th>
                  <Th width={110} align="center">
                    Ações
                  </Th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
                {visible.map((r) => {
                  const rPhones = getPhonesArray(r);
                  const rEmails = getEmailsArray(r);
                  return (
                    <tr
                      key={r.id}
                      className={`transition-colors group cursor-pointer ${selectedIds.has(r.id) ? "bg-indigo-50/50 dark:bg-indigo-500/10" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
                      onClick={() =>
                        toggleSelected(r.id, !selectedIds.has(r.id))
                      }
                    >
                      <Td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={(e) =>
                            toggleSelected(r.id, e.target.checked)
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-slate-300 dark:border-white/20 bg-slate-100 dark:bg-white/5"
                        />
                      </Td>

                      {/* FOTO + NOME */}
                      <Td>
                        <div className="flex items-center gap-2 py-1">
                          {r.avatar_url ? (
                            <img
                              src={r.avatar_url}
                              alt="Foto"
                              className="w-[40px] h-[40px] rounded-full object-cover border border-slate-200 dark:border-border shadow-sm shrink-0"
                            />
                          ) : (
                            <div className="w-[40px] h-[40px] rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center font-medium text-slate-500 dark:text-white/50 text-xl shrink-0">
                              {r.display_name?.charAt(0) || "?"}
                            </div>
                          )}
                          <div className="font-medium text-sm text-slate-800 dark:text-white leading-tight max-w-[160px]">
                            {r.display_name || "Sem Nome"}
                          </div>
                        </div>
                      </Td>

                      {/* TELEFONES */}
                      <Td>
                        <div className="flex flex-col gap-1 py-1">
                          {rPhones.length > 0 ? (
                            rPhones.map((p) => (
                              <div
                                key={p.id}
                                className="text-[13px] whitespace-nowrap"
                              >
                                <span className="font-medium text-slate-500 dark:text-white/50">
                                  {p.label?.endsWith(":")
                                    ? p.label
                                    : `${p.label}:`}{" "}
                                </span>
                                <span className="text-slate-700 dark:text-white/80">
                                  {displayPhone(p.value)}
                                </span>
                              </div>
                            ))
                          ) : (
                            <span className="italic text-slate-400 text-xs">
                              Sem telefone
                            </span>
                          )}
                        </div>
                      </Td>

                      {/* EMAILS */}
                      <Td>
                        <div className="flex flex-col gap-1 py-1">
                          {rEmails.length > 0 ? (
                            rEmails.map((e) => (
                              <div
                                key={e.id}
                                className="text-[13px] truncate max-w-[240px]"
                              >
                                <span className="font-medium text-slate-500 dark:text-white/50">
                                  {e.label}:{" "}
                                </span>
                                <span className="text-sky-600 dark:text-sky-400">
                                  {e.value}
                                </span>
                              </div>
                            ))
                          ) : (
                            <span className="italic text-slate-400 text-xs">
                              —
                            </span>
                          )}
                        </div>
                      </Td>

                      <Td align="center">
                        <div className="flex flex-wrap gap-1 justify-center max-w-[200px] mx-auto">
                          {(r.labels || []).filter((l) => l && l.trim())
                            .length > 0 ? (
                            (r.labels || [])
                              .filter((l) => l && l.trim())
                              .map((l) => (
                                <span
                                  key={l}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-500/20 bg-slate-50 text-[10px] font-medium tracking-tight shadow-sm dark:bg-white/[0.08] text-slate-600 dark:text-white/75 border border-slate-200 dark:border-white/15"
                                >
                                  {l}
                                </span>
                              ))
                          ) : (
                            <span className="text-slate-300 dark:text-white/20 text-xs italic">
                              —
                            </span>
                          )}
                        </div>
                      </Td>

                      <Td align="right">
                        <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 relative">
                          <div className="relative">
                            <IconActionBtn
                              title="WhatsApp"
                              tone="green"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (rPhones.length === 0)
                                  return addToast(
                                    "warning",
                                    "Sem telefone",
                                    "Este contato não possui um número válido.",
                                  );
                                setMsgMenuForId((cur) =>
                                  cur === r.id ? null : r.id,
                                );
                              }}
                            >
                              <IconChat />
                            </IconActionBtn>
                            {msgMenuForId === r.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 dark:border-border bg-white dark:bg-background z-50 shadow-2xl overflow-hidden"
                              >
                                {rPhones.map((p) => (
                                  <MenuItem
                                    key={p.id}
                                    icon={<IconSend />}
                                    label={`Para: ${p.label}`}
                                    onClick={() => {
                                      setMsgMenuForId(null);
                                      setMessageText("");
                                      setShowSendNow({
                                        open: true,
                                        contactId: r.id,
                                        phone: p.value,
                                      });
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                          <IconActionBtn
                            title="Editar Contato"
                            tone="amber"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(r);
                            }}
                          >
                            <IconEdit />
                          </IconActionBtn>
                          <IconActionBtn
                            title="Excluir"
                            tone="red"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteModal({ open: true, contact: r });
                            }}
                          >
                            <IconTrash />
                          </IconActionBtn>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* PAGINAÇÃO */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-border">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 dark:text-muted-foreground">
                    {(safePage - 1) * pageSize + 1}–
                    {Math.min(safePage * pageSize, sorted.length)} de{" "}
                    {sorted.length}
                  </span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="h-7 px-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded text-xs text-slate-600 dark:text-white"
                  >
                    <option value={30}>30 por página</option>
                    <option value={50}>50 por página</option>
                    <option value={100}>100 por página</option>
                    <option value={200}>200 por página</option>
                    <option value={500}>500 por página</option>
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(1)}
                    disabled={safePage === 1}
                    className="h-7 w-7 rounded flex items-center justify-center text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30 transition-colors text-xs font-medium"
                  >
                    «
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="h-7 w-7 rounded flex items-center justify-center text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30 transition-colors text-xs font-medium"
                  >
                    ‹
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(
                      (p) =>
                        p === 1 ||
                        p === totalPages ||
                        Math.abs(p - safePage) <= 2,
                    )
                    .reduce<(number | "...")[]>((acc, p, i, arr) => {
                      if (i > 0 && p - (arr[i - 1] as number) > 1)
                        acc.push("...");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) =>
                      p === "..." ? (
                        <span
                          key={`ellipsis-${i}`}
                          className="h-7 w-7 flex items-center justify-center text-slate-400 text-xs"
                        >
                          …
                        </span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p as number)}
                          className={`h-7 w-7 rounded flex items-center justify-center text-xs font-bold transition-colors ${safePage === p ? "bg-emerald-600 text-white" : "text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/10"}`}
                        >
                          {p}
                        </button>
                      ),
                    )}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="h-7 w-7 rounded flex items-center justify-center text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30 transition-colors text-xs font-medium"
                  >
                    ›
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={safePage === totalPages}
                    className="h-7 w-7 rounded flex items-center justify-center text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30 transition-colors text-xs font-medium"
                  >
                    »
                  </button>
                </div>
              </div>
            )}
            <div className="h-8 md:h-6" />
          </div>
        </div>
      )}

      {/* ── MODAL WHATSAPP ───────────────────────────────────────────────── */}
      {showSendNow.open && (
        <Modal
          title="Enviar Mensagem Rápida"
          onClose={() =>
            setShowSendNow({ open: false, contactId: null, phone: null })
          }
        >
          <div className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 p-3 rounded-lg flex items-center gap-3">
              <span className="text-xl">
                <MessageCircle className="w-4 h-4" />
              </span>
              <div className="text-sm text-emerald-900 dark:text-emerald-200">
                Enviando para{" "}
 <strong className=" ">
                  {displayPhone(showSendNow.phone!)}
                </strong>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-400 dark:text-muted-foreground mb-1.5 uppercase tracking-wider">
                Sessão de Envio
              </label>
              <select
                value={selectedSessionNow}
                onChange={(e) => setSelectedSessionNow(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-border rounded-xl text-slate-800 dark:text-white outline-none text-sm font-medium"
              >
                {sessionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-border rounded-xl p-4 text-slate-800 dark:text-white outline-none min-h-[120px] text-sm resize-none"
              placeholder="Digite a sua mensagem..."
              autoFocus
            />
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() =>
                  setShowSendNow({ open: false, contactId: null, phone: null })
                }
                className="px-4 py-2 rounded-lg text-slate-500 dark:text-muted-foreground text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendMessage}
                disabled={sendingNow}
                className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-2 text-sm disabled:opacity-50"
              >
                <IconSend /> {sendingNow ? "Enviando..." : "Enviar Agora"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL CRIAR / EDITAR ─────────────────────────────────────────── */}
      {editModal.open && (
        <Modal
          title={editModal.contact ? "Editar Contato" : "Novo Contato"}
          onClose={() => setEditModal({ open: false, contact: null })}
        >
          <div className="space-y-5 max-h-[80vh] overflow-y-auto px-1 pb-4">
            {/* Foto clicável */}
            <div
              className="flex justify-center mb-2 relative group w-24 h-24 mx-auto cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handlePhotoUpload}
              />
              {editForm.new_photo_base64 || editModal.contact?.avatar_url ? (
                <img
                  src={
                    editForm.new_photo_base64 ||
                    editModal.contact?.avatar_url ||
                    ""
                  }
                  alt="Foto"
                  className="w-24 h-24 rounded-full object-cover border-2 border-slate-200 dark:border-white/20 group-hover:opacity-50 transition-opacity"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center font-medium text-slate-500 dark:text-muted-foreground text-2xl group-hover:opacity-50 transition-opacity">
                  {editForm.display_name?.charAt(0) || "?"}
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white drop-shadow-md text-sm font-medium">
                📸 Alterar
              </div>
            </div>

            {/* Nome */}
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1">
                Nome Completo
              </label>
              <input
                value={editForm.display_name}
                onChange={(e) =>
                  setEditForm({ ...editForm, display_name: e.target.value })
                }
                className="w-full p-2.5 border border-slate-200 dark:border-border rounded-lg bg-slate-50 dark:bg-black/20 text-slate-800 dark:text-white outline-none focus:border-amber-500 text-sm font-medium"
              />
            </div>

            <div className="border-t border-slate-200 dark:border-border" />

            {/* ── TELEFONES ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground">
                  Telefones
                </label>
                <button
                  onClick={() =>
                    setEditForm((prev) => ({
                      ...prev,
                      phones: [
                        ...prev.phones,
                        {
                          id: Date.now().toString(),
                          label: "Celular",
                          ddi: "55",
                          national: "",
                          confirmed: false,
                        },
                      ],
                    }))
                  }
                  className="text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1"
                >
                  + Add Telefone
                </button>
              </div>

              <div className="space-y-4">
                {editForm.phones.map((p, idx) => {
                  const wa = waValidations[p.id];
                  const e164Preview =
                    p.confirmed && p.national
                      ? `+${p.ddi}${onlyDigits(p.national)}`
                      : null;

                  return (
                    <div
                      key={p.id}
                      className="space-y-2 p-3 rounded-lg border border-slate-200 dark:border-border bg-slate-50/50 dark:bg-black/10"
                    >
                      {/* Linha 1: rótulo + DDI + número + confirmar + remover */}
                      <div className="flex gap-2 items-center">
                        {/* Rótulo */}
                        <input
                          placeholder="Rótulo"
                          value={p.label}
                          onChange={(e) =>
                            setEditForm((prev) => {
                              const phones = [...prev.phones];
                              phones[idx] = {
                                ...phones[idx],
                                label: e.target.value,
                              };
                              return { ...prev, phones };
                            })
                          }
                          className="w-20 p-2 border border-slate-200 dark:border-border rounded-lg bg-white dark:bg-black/30 text-slate-800 dark:text-white text-xs font-medium"
                        />
                        {/* DDI */}
                        <select
                          value={p.ddi}
                          onChange={(e) =>
                            setEditForm((prev) => {
                              const phones = [...prev.phones];
                              phones[idx] = {
                                ...phones[idx],
                                ddi: e.target.value,
                                confirmed: false,
                              };
                              return { ...prev, phones };
                            })
                          }
                          className="h-9 px-2 bg-white dark:bg-black/30 border border-slate-200 dark:border-border rounded-lg text-xs text-slate-700 dark:text-white"
                        >
                          {DDI_OPTIONS.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.flag} +{o.code}
                            </option>
                          ))}
                        </select>
                        {/* Número nacional */}
                        <input
                          placeholder={
                            p.ddi === "55" ? "21 99999-9999" : "número"
                          }
                          value={p.national}
                          onChange={(e) =>
                            setEditForm((prev) => {
                              const phones = [...prev.phones];
                              phones[idx] = {
                                ...phones[idx],
                                national: e.target.value,
                                confirmed: false,
                              };
                              return { ...prev, phones };
                            })
                          }
                          onBlur={() => confirmPhone(idx)}
 className="flex-1 p-2 border border-slate-200 dark:border-border rounded-lg bg-white dark:bg-black/20 text-slate-800 dark:text-white text-sm min-w-0"
                        />

                        {/* Remover */}
                        <button
                          onClick={() => {
                            setEditForm((prev) => ({
                              ...prev,
                              phones: prev.phones.filter((x) => x.id !== p.id),
                            }));
                            setWaValidations((prev) => {
                              const n = { ...prev };
                              delete n[p.id];
                              return n;
                            });
                          }}
                          className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg"
                        >
                          <IconTrash />
                        </button>
                      </div>

                      {/* Linha 2: Botões de Ação e Status */}
                      <div className="flex flex-wrap items-center gap-2 px-1">
                        {/* Botão 1: WhatsApp Status */}
                        <button
                          onClick={() => {
                            const clean = onlyDigits(p.national);
                            if (clean.length >= 8)
                              validateWaForPhone(p.id, `+${p.ddi}${clean}`);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                            wa?.loading
                              ? "bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-border"
                              : wa?.exists
                                ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30"
                                : wa?.exists === false
                                  ? "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/30"
                                  : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border-slate-200 dark:border-border hover:bg-slate-200 dark:hover:bg-white/10"
                          }`}
                        >
                          {wa?.loading
                            ? "⏳ Validando..."
                            : wa?.exists
                              ? "✅ WhatsApp Ativo"
                              : wa?.exists === false && p.confirmed
                                ? "❌ Não Encontrado"
                                : "Status WhatsApp"}
                        </button>

                        {/* Botão 2: Sincronizar Foto */}
                        <button
                          onClick={() => {
                            const clean = onlyDigits(p.national);
                            if (!editModal.contact?.id) {
                              addToast(
                                "warning",
                                "Atenção",
                                "Salve o contato antes de sincronizar a foto.",
                              );
                              return;
                            }

                            if (wa?.exists && wa?.jid) {
                              // Já possui o JID validado, busca a foto direto
                              handleSyncWaPhotoSilent(
                                editModal.contact.id,
                                wa.jid,
                                p.id,
                              );
                            } else if (clean.length >= 8) {
                              // Não validou o WA ainda: ativa o loading visual da foto, valida o WA e passa o ID para o auto-sync da foto rodar em seguida
                              setWaValidations((prev) => ({
                                ...prev,
                                [p.id]: {
                                  ...prev[p.id],
                                  photoStatus: "loading",
                                },
                              }));
                              validateWaForPhone(
                                p.id,
                                `+${p.ddi}${clean}`,
                                editModal.contact.id,
                              );
                            }
                          }}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                            wa?.photoStatus === "loading"
                              ? "bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-border"
                              : wa?.photoStatus === "synced"
                                ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30"
                                : wa?.photoStatus === "protected"
                                  ? "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30"
                                  : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border-slate-200 dark:border-border hover:bg-slate-200 dark:hover:bg-white/10"
                          }`}
                        >
                          {wa?.photoStatus === "loading"
                            ? "⏳ Buscando Foto..."
                            : wa?.photoStatus === "synced"
                              ? "📸 Foto Sincronizada"
                              : wa?.photoStatus === "protected"
                                ? "🔒 Foto Protegida"
                                : "Sincronizar Foto"}
                        </button>

                        {/* Botão 3: Sincronizar Operadora / Info do País */}
                        {p.ddi === "55" ? (
                          <button
                            onClick={() => {
                              const clean = onlyDigits(p.national);
                              if (clean.length >= 10)
                                lookupOperadoraForPhone(p.id, p.ddi, clean);
                            }}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                              wa?.opLoading
                                ? "bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-border"
                                : wa?.opName
                                  ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30"
                                  : wa?.opError
                                    ? "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/30"
                                    : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border-slate-200 dark:border-border hover:bg-slate-200 dark:hover:bg-white/10"
                            }`}
                          >
                            {wa?.opLoading
                              ? "⏳ Buscando..."
                              : wa?.opName
                                ? "📡 Operadora Atualizada"
                                : wa?.opError
                                  ? "⚠️ Falha ao buscar"
                                  : "Sincronizar Operadora"}
                          </button>
                        ) : (
                          <div className="px-3 py-1.5 rounded-lg text-[11px] font-medium border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center gap-1 cursor-default">
                            🌍{" "}
                            {DDI_OPTIONS.find((o) => o.code === p.ddi)?.label ||
                              "Internacional"}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {editForm.phones.length === 0 && (
                  <div className="text-xs text-slate-400 dark:text-white/30 italic">
                    Nenhum telefone.
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-border" />

            {/* ── EMAILS ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground">
                  E-mails
                </label>
                <button
                  onClick={() =>
                    setEditForm((prev) => ({
                      ...prev,
                      emails: [
                        ...prev.emails,
                        {
                          id: Date.now().toString(),
                          label: "Pessoal",
                          value: "",
                        },
                      ],
                    }))
                  }
                  className="text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400 font-medium"
                >
                  + Add E-mail
                </button>
              </div>
              <div className="space-y-2">
                {editForm.emails.map((e, idx) => (
                  <div key={e.id} className="flex gap-2 items-center">
                    <input
                      placeholder="Rótulo"
                      value={e.label}
                      onChange={(ev) =>
                        setEditForm((prev) => {
                          const emails = [...prev.emails];
                          emails[idx] = {
                            ...emails[idx],
                            label: ev.target.value,
                          };
                          return { ...prev, emails };
                        })
                      }
                      className="w-20 p-2 border border-slate-200 dark:border-border rounded-lg bg-white dark:bg-black/30 text-slate-800 dark:text-white text-xs font-medium"
                    />
                    <input
                      placeholder="email@exemplo.com"
                      value={e.value}
                      onChange={(ev) =>
                        setEditForm((prev) => {
                          const emails = [...prev.emails];
                          emails[idx] = {
                            ...emails[idx],
                            value: ev.target.value,
                          };
                          return { ...prev, emails };
                        })
                      }
                      className="flex-1 p-2 border border-slate-200 dark:border-border rounded-lg bg-slate-50 dark:bg-black/20 text-slate-800 dark:text-white text-sm"
                    />
                    <button
                      onClick={() =>
                        setEditForm((prev) => ({
                          ...prev,
                          emails: prev.emails.filter((x) => x.id !== e.id),
                        }))
                      }
                      className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg"
                    >
                      <IconTrash />
                    </button>
                  </div>
                ))}
                {editForm.emails.length === 0 && (
                  <div className="text-xs text-slate-400 dark:text-white/30 italic">
                    Nenhum e-mail.
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-border" />

            {/* ── GRUPOS ── */}
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1.5">
                Grupos / Marcadores (Google)
              </label>
              <input
                value={(editForm.labels || []).join(", ")}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    labels: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s),
                  })
                }
                className="w-full p-2.5 border border-slate-200 dark:border-border rounded-lg bg-slate-50 dark:bg-black/20 text-slate-800 dark:text-white outline-none focus:border-amber-500 text-sm"
                placeholder="Ex: VIP, Família, Empresa"
              />
              {/* Tags clicáveis dos grupos existentes */}
              {uniqueLabels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {uniqueLabels.map((lbl) => {
                    const active = editForm.labels.includes(lbl);
                    return (
                      <button
                        key={lbl}
                        onClick={() =>
                          setEditForm((prev) => ({
                            ...prev,
                            labels: active
                              ? prev.labels.filter((l) => l !== lbl)
                              : [...prev.labels, lbl],
                          }))
                        }
                        className={`text-[10px] px-2 py-0.5 rounded font-medium border transition-colors ${active ? "bg-amber-500 text-white border-amber-500" : "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/50 border-slate-200 dark:border-border hover:bg-slate-200 dark:hover:bg-white/10"}`}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Botões */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-border">
              <button
                onClick={() => setEditModal({ open: false, contact: null })}
                className="px-4 py-2 rounded-lg text-slate-500 dark:text-muted-foreground text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveContact}
                disabled={isSaving}
                className="px-6 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-medium flex items-center gap-2 text-sm disabled:opacity-50"
              >
                {isSaving ? "Salvando..." : "Salvar no Google"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL EXCLUSÃO ───────────────────────────────────────────────── */}
      {deleteModal.open && deleteModal.contact && (
        <Modal
          title="Excluir Contato"
          onClose={() => setDeleteModal({ open: false, contact: null })}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-muted-foreground">
              Você está prestes a excluir o contato{" "}
              <strong>{deleteModal.contact.display_name}</strong>.
            </p>
            <label className="flex items-center gap-3 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={deleteFromGoogle}
                onChange={(e) => setDeleteFromGoogle(e.target.checked)}
                className="w-5 h-5 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
              />
              <span className="text-sm font-medium text-rose-900 dark:text-rose-200">
                Excluir também da agenda do celular (Google Contacts)
              </span>
            </label>
            <div className="flex justify-end gap-3 pt-4">
              <button
                onClick={() => setDeleteModal({ open: false, contact: null })}
                className="px-4 py-2 rounded-lg text-slate-500 dark:text-muted-foreground text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteContact}
                disabled={isDeleting}
                className="px-6 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-2 text-sm disabled:opacity-50"
              >
                {isDeleting ? "Excluindo..." : "Confirmar Exclusão"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 👇 Renderiza o modal na tela quando acionado */}
      {ConfirmUI}

      <div className="relative z-[999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

export default function AgendaPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-slate-400 animate-pulse">
          Carregando Agenda...
        </div>
      }
    >
      <AgendaPageContent />
    </Suspense>
  );
}

// ─── COMPONENTES VISUAIS ─────────────────────────────────────────────────────
const ALIGN_CLASS: Record<"left" | "right" | "center", string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};
function Th({
  children,
  width,
  align = "left",
}: {
  children: React.ReactNode;
  width?: number;
  align?: "left" | "right" | "center";
}) {
  return (
    <th className={`px-3 py-2 ${ALIGN_CLASS[align]}`} style={{ width }}>
      {children}
    </th>
  );
}
function ThSort({
  label,
  active,
  dir,
  onClick,
  width,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  width?: number;
}) {
  return (
    <th
      onClick={onClick}
      style={{ width }}
      className="px-3 py-2 cursor-pointer select-none group hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors text-left"
    >
      <div className="flex items-center gap-1">
        {label}{" "}
        <span
          className={`transition-opacity ${active ? "opacity-100 text-emerald-600" : "opacity-40 group-hover:opacity-70"}`}
        >
          {dir === "asc" ? <IconSortUp /> : <IconSortDown />}
        </span>
      </div>
    </th>
  );
}
function SortClick({
  label,
  onClick,
  active,
  dir,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
}) {
  return (
    <div
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1 cursor-pointer select-none hover:text-emerald-500 transition-colors"
    >
      <span className="font-medium uppercase text-xs tracking-wide">{label}</span>
      <span
        className={`transition-opacity flex items-center ${active ? "opacity-100 text-emerald-600" : "opacity-30"}`}
      >
        {dir === "asc" ? <IconSortUp /> : <IconSortDown />}
      </span>
    </div>
  );
}
function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  const a =
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";
  return <td className={`px-3 py-2 ${a} align-middle`}>{children}</td>;
}

function IconActionBtn({
  children,
  title,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: React.MouseEvent) => void;
}) {
  const colors = {
    blue: "text-sky-500 bg-sky-50 border-sky-200 hover:bg-sky-100 dark:bg-sky-500/10 dark:border-sky-500/20",
    green:
      "text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20",
    amber:
      "text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20",
    purple:
      "text-purple-600 bg-purple-50 border-purple-200 hover:bg-purple-100",
    red: "text-rose-600 bg-rose-50 border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:border-rose-500/20",
  };
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={title}
      className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}
    >
      {children}
    </button>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group w-full px-4 py-2.5 flex items-center gap-3 text-slate-600 dark:text-white/60 hover:bg-emerald-500/10 hover:text-emerald-600 transition-all text-left text-sm font-medium tracking-tight rounded-lg"
    >
      <span className="opacity-70 group-hover:scale-110 transition-transform">
        {icon}
      </span>
      {label}
    </button>
  );
}

// Modal com dark mode corrigido — usa dark:bg-card alinhado ao padrão do sistema
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        display: "grid",
        placeItems: "center",
        zIndex: 99999,
        padding: 16,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-border bg-slate-50 dark:bg-muted">
          <div className="font-medium text-slate-800 dark:text-white">
            {title}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/50"
          >
            <IconX />
          </button>
        </div>
        <div className="p-4 bg-white dark:bg-card">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ─── ÍCONES ──────────────────────────────────────────────────────────────────
function IconX() {
  return <X className="w-4 h-4" />;
}
function IconSortUp() {
  return <ChevronUp className="w-3 h-3" />;
}
function IconSortDown() {
  return <ChevronDown className="w-3 h-3" />;
}
function IconChat() {
  return <MessageCircle className="w-4 h-4" />;
}
function IconSend() {
  return <Send className="w-4 h-4" />;
}
function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
function IconTrash() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
    </svg>
  );
}
function IconSync() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21v-5h5" />
    </svg>
  );
}
