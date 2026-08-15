"use client";
// app/admin/agenda/page.tsx
import {
  Loader2,
  X,
  ChevronUp,
  ChevronDown,
  MessageCircle,
  Pencil,
  EyeOff,
  Eye,
  Upload,
  RefreshCw,
} from "lucide-react";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useSearchParams, useRouter } from "next/navigation";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import Pagination from "@/components/ui/Pagination";
import { Dropdown } from "@/components/ui/Dropdown";
import {
  type GoogleContact,
  displayPhone,
  getPhonesArray,
  getEmailsArray,
  IconTrash,
  IconSend,
} from "./shared";

// ✅ Carregamento sob demanda (14/08/2026) — cada um só baixa quando o
// respectivo modal abre: Editar/Criar Contato (o mais pesado, form
// completo com validação de WhatsApp/operadora), Enviar Mensagem Rápida e
// Excluir Contato.
const EditContatoModal = dynamic(() => import("./EditContatoModal"), {
  ssr: false,
});
const EnviarMensagemModal = dynamic(() => import("./EnviarMensagemModal"), {
  ssr: false,
});
const ExcluirContatoModal = dynamic(() => import("./ExcluirContatoModal"), {
  ssr: false,
});

type SortKey = "name" | "labels" | "birthday";
type SortDir = "asc" | "desc";

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
  const resolvedTenantId = useTenantId();
  const searchParams = useSearchParams();
  const router = useRouter();

  // 👇 Ativando o nosso confirm customizado
  const { confirm, ConfirmUI } = useConfirm();
  const [valuesHidden, setValuesHidden] = useState(false);

  const [rows, setRows] = useState<GoogleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(resolvedTenantId);

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
  const groupBtnRef = useRef<HTMLButtonElement | null>(null);
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
  // Só uma linha tem o menu aberto por vez — a ref é "realocada" pra
  // wrapper da linha atualmente aberta (ver uso abaixo).
  const msgMenuTriggerRef = useRef<HTMLDivElement | null>(null);
  const [showSendNow, setShowSendNow] = useState<{
    open: boolean;
    contactId: string | null;
    phone: string | null;
  }>({ open: false, contactId: null, phone: null });
  // ✅ sessionOptions/selectedSessionNow ficam aqui (não no modal extraído):
  // pré-carregados no mount da página (loadWhatsAppSessions abaixo) e o
  // valor escolhido persiste entre aberturas do modal — comportamento
  // original preservado.
  const [sessionOptions, setSessionOptions] = useState<
    { id: string; label: string }[]
  >([{ id: "default", label: "Carregando..." }]);
  const [selectedSessionNow, setSelectedSessionNow] = useState("default");

  // Edit modal — o form em si (editForm/waValidations/etc.) vive dentro de
  // EditContatoModal.tsx agora; aqui só fica o "gatilho" (o quê abrir).
  const [editModal, setEditModal] = useState<{
    open: boolean;
    contact: GoogleContact | null;
  }>({ open: false, contact: null });

  // Delete modal — mesma ideia: só o gatilho, o resto vive em ExcluirContatoModal.tsx.
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    contact: GoogleContact | null;
  }>({ open: false, contact: null });
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

  // ✅ Diferente do "Reenviar" — aqui cada telefone ainda passa pela Telein
  // (API externa de operadora, sem batch possível, consultada 1 por 1 com
  // pausa) antes do envio ao Google, que esse sim já vai em lote. Por causa
  // dessa pausa por telefone, o gargalo de tempo continua sendo a Telein —
  // mantém um chunk menor que o do "Reenviar" pra não estourar o teto de
  // 10s da Vercel mesmo em uma seleção grande.
  async function handleMassSyncOperadora() {
    if (selectedIds.size === 0) return;
    setIsSyncingOperadora(true);
    const ids = Array.from(selectedIds);
    const CHUNK = 25;
    let totalMessage = "";
    const allErrors: string[] = [];

    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const res = await fetch("/api/auth/google/sync-operadora", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_ids: slice }),
        });
        const data = await res.json();
        if (res.ok) {
          totalMessage = data.message;
          if (data.errors?.length) allErrors.push(...data.errors);
        } else {
          allErrors.push(data.error || "Erro no lote.");
        }
      }

      addToast(
        "success",
        "Operadoras Atualizadas",
        totalMessage || "Concluído.",
      );
      if (allErrors.length)
        addToast("warning", "Alguns erros", allErrors.slice(0, 3).join(" | "));
      loadData();
      setSelectedIds(new Set());
    } catch (err: any) {
      addToast("error", "Erro", err.message);
    } finally {
      setIsSyncingOperadora(false);
    }
  }

  const [isPushingGoogle, setIsPushingGoogle] = useState(false);

  // Reenvia o que JÁ ESTÁ no Supabase pro Google (nome, telefones+operadora,
  // emails, labels/grupos). NÃO consulta a Telein — zero gasto de crédito.
  // Processa em chunks pra caber no teto de 10s da Vercel grátis — a rota
  // agora usa people:batchGet/batchUpdateContacts (poucas chamadas HTTP pro
  // Google por lote, não mais uma por contato), então 150 por vez ainda cabe
  // folgado no teto de 10s (antes, com 1 GET+1 PATCH por contato, só dava
  // pra arriscar 10 por vez).
  async function handleMassPushGoogle() {
    if (selectedIds.size === 0) return;
    setIsPushingGoogle(true);
    const ids = Array.from(selectedIds);
    const CHUNK = 150;
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

  // Mesma lógica de chunking de handleMassPushGoogle — a rota já é batelada
  // no Google (batchGet/batchUpdateContacts), 150 por vez cabe folgado no
  // teto de 10s da Vercel grátis.
  async function handleMassAssignGroup(label: string) {
    if (!label.trim() || selectedIds.size === 0) return;
    setIsAssigningGroup(true);
    setShowGroupPopover(false);
    setNewGroupInput("");
    const ids = Array.from(selectedIds);
    const CHUNK = 150;
    let totalUpdated = 0;
    const allErrors: string[] = [];
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const res = await fetch("/api/auth/google/bulk-add-label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contact_ids: slice,
            label: label.trim(),
          }),
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
        "Grupo atribuído",
        `${totalUpdated} contato(s) atribuídos ao grupo "${label.trim()}".`,
      );
      if (allErrors.length)
        addToast("warning", "Alguns erros", allErrors.slice(0, 3).join(" | "));
      loadData();
    } catch (err: any) {
      addToast("error", "Erro", err.message);
    } finally {
      setIsAssigningGroup(false);
    }
  }

  // ─── EFEITOS ───────────────────────────────────────────────────────────────
  async function loadData() {
    setLoading(true);
    try {
      const tid = tenantId;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ─── FILTROS & ORDENAÇÃO ───────────────────────────────────────────────────
  // Reseta a seleção ao trocar de página OU mudar qualquer filtro,
  // pra cada página ser um lote independente (sem seleção "fantasma").
  useEffect(() => {
    setSelectedIds(new Set());
  }, [
    search,
    labelFilter,
    emailLabelFilter,
    phoneLabelFilter,
    photoFilter,
    page,
    pageSize,
  ]);

  // Volta para a página 1 sempre que um filtro muda (mesmo padrão da página de clientes)
  useEffect(() => {
    setPage(1);
  }, [search, labelFilter, emailLabelFilter, phoneLabelFilter, photoFilter]);

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

  // Sem seleção: "sincroniza tudo" continua 1 chamada só, atômica, tratada
  // inteira no servidor (a rota já filtra localmente quem precisa mudar
  // antes de gastar chamada de API — não dá pra chunkar isso do frontend
  // sem antes saber os ids, e o próprio filtro local já reduz bastante o
  // que sobra pro Google). Com seleção: chunka igual handleMassPushGoogle,
  // mesma folga de 150 por lote (rota já batelada no Google).
  async function handleSyncLabels() {
    setIsSyncingLabels(true);
    try {
      if (selectedIds.size === 0) {
        const res = await fetch("/api/auth/google/sync-labels-from-clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_ids: null }),
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
        return;
      }

      const ids = Array.from(selectedIds);
      const CHUNK = 150;
      let lastMessage = "";
      const allErrors: string[] = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const res = await fetch("/api/auth/google/sync-labels-from-clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact_ids: slice }),
        });
        const data = await res.json();
        if (res.ok) {
          lastMessage = data.message;
          if (data.errors?.length) allErrors.push(...data.errors);
        } else {
          allErrors.push(data.error || "Erro no lote.");
        }
      }
      addToast("success", "Vinculação concluída", lastMessage || "Concluído.");
      if (allErrors.length)
        addToast("warning", "Alguns erros", allErrors.slice(0, 3).join(" | "));
      loadData();
    } catch (err: any) {
      addToast("error", "Erro", err.message);
    } finally {
      setIsSyncingLabels(false);
    }
  }

  // ─── MODAL EDIT ────────────────────────────────────────────────────────────
  // ✅ O form (editForm/waValidations/etc.) agora inicializa sozinho dentro
  // de EditContatoModal.tsx a partir do prop `contact` — aqui só abre.
  function openEditModal(contact: GoogleContact) {
    setEditModal({ open: true, contact });
  }

  function openCreateModal() {
    setEditModal({ open: true, contact: null });
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div
      className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors"
      onClick={() => {
        setMsgMenuForId(null);
        setShowGroupPopover(false);
      }}
    >
      {/* HEADER */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              Agenda
            </h1>
            <button
              onClick={() => setValuesHidden((v) => !v)}
              title={valuesHidden ? "Exibir valores" : "Ocultar valores"}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all text-xs font-medium shadow-sm select-none"
            >
              {valuesHidden ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              <span className="hidden sm:inline text-[11px] tracking-wide">
                {valuesHidden ? "Exibir" : "Ocultar"}
              </span>
            </button>
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
            className="h-8 md:h-10 px-2.5 md:px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-[11px] md:text-sm flex items-center gap-1.5 shadow-lg shadow-sky-900/20 transition-all disabled:opacity-50 whitespace-nowrap"
          >
            <IconSync /> Importar Google
          </button>
        </div>
      </div>

      {/* FILTROS */}
      <div className="px-3 md:p-4 bg-transparent md:bg-card border-0 md:border md:border-border rounded-none md:rounded-xl shadow-none md:shadow-sm mb-4 z-20">
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
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none text-foreground/90 placeholder-muted-foreground"
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
              className="h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground"
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
              className="h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90"
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
              className="h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90"
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
              className="h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90"
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
                className="h-10 px-3 rounded-lg text-xs font-medium text-rose-500 border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 transition-colors whitespace-nowrap inline-flex items-center gap-1"
              >
                <IconX /> Limpar
              </button>
            )}
          </div>

          {/* Botão filtros — só no mobile */}
          <button
            onClick={() => setShowMobileFilters((v) => !v)}
            className={`md:hidden h-10 px-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-1.5 ${
              hasActiveFilters
                ? "bg-amber-500 text-white border-amber-500"
                : "bg-transparent border-border text-muted-foreground"
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
              className="h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90"
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
              className="h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90"
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
              className="h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90"
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
              className="h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90"
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
                className="h-10 px-3 rounded-lg text-xs font-medium text-rose-500 border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 transition-colors whitespace-nowrap inline-flex items-center gap-1"
              >
                <IconX /> Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* SELEÇÃO EM MASSA */}
      {selectedIds.size > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-3 overflow-x-auto p-3 bg-sky-500/10 border border-sky-500/20 rounded-xl mb-4 animate-in slide-in-from-top-2 mx-3 sm:mx-0"
        >
          <span className="text-xs font-medium text-sky-500 shrink-0 whitespace-nowrap">
            {selectedIds.size} contato(s) selecionado(s)
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleMassPushGoogle}
              disabled={isPushingGoogle}
              className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {isPushingGoogle ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Reenviando ao Google...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Reenviar Google ({selectedIds.size})
                </>
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
                <>
                  <RefreshCw className="w-4 h-4" />
                  Operadora ({selectedIds.size})
                </>
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
                <>
                  <RefreshCw className="w-4 h-4" />
                  Servidor ({selectedIds.size})
                </>
              )}
            </button>
            {/* NOVO: Atribuir Grupo */}
            <div className="relative">
              <button
                ref={groupBtnRef}
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
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Grupo
                  </>
                )}
              </button>

              <Dropdown
                open={showGroupPopover}
                onClose={() => setShowGroupPopover(false)}
                triggerRef={groupBtnRef}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="p-3 space-y-2"
                >
                  <p className="text-[11px] font-medium text-foreground/70 uppercase tracking-wide">
                    Grupos existentes
                  </p>
                  <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                    {uniqueLabels
                      .filter((l) => l && l.trim())
                      .map((lbl) => (
                        <button
                          key={lbl}
                          onClick={() => handleMassAssignGroup(lbl)}
                          className="text-[11px] px-2 py-0.5 rounded font-medium bg-transparent text-muted-foreground border border-border hover:bg-amber-500 hover:text-white hover:border-amber-500 transition-colors"
                        >
                          {lbl}
                        </button>
                      ))}
                  </div>
                  <div className="border-t border-border pt-2">
                    <p className="text-[11px] font-medium text-foreground/70 uppercase tracking-wide mb-1.5">
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
                        className="flex-1 h-8 px-2 text-xs border border-border rounded-lg bg-transparent text-foreground outline-none focus:border-amber-500"
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
              </Dropdown>
            </div>
          </div>
        </div>
      )}

      {/* TABELA */}
      {!loading && (
        <div className="bg-card border border-border rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0">
          <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-border bg-transparent">
            <div className="text-sm font-medium tracking-tight text-foreground whitespace-nowrap">
              Lista de Contatos{" "}
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-xs font-medium">
                {filtered.length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px] table-fixed">
              <thead>
                <tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
                  <Th width={36}>
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={
                        visible.length > 0 &&
                        visible.every((r) => selectedIds.has(r.id))
                      }
                      onChange={(e) => setAllVisible(e.target.checked)}
                      className="rounded border-border bg-transparent cursor-pointer"
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
              <tbody className="text-sm divide-y divide-border">
                {visible.map((r) => {
                  const rPhones = getPhonesArray(r);
                  const rEmails = getEmailsArray(r);
                  return (
                    <tr
                      key={r.id}
                      className={`transition-colors group cursor-pointer ${selectedIds.has(r.id) ? "bg-sky-500/10" : "hover:bg-muted/50"}`}
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
                          className="rounded border-border bg-transparent"
                        />
                      </Td>

                      {/* FOTO + NOME */}
                      <Td>
                        <div className="flex items-center gap-2 py-1">
                          {r.avatar_url ? (
                            <img
                              src={r.avatar_url}
                              alt="Foto"
                              className="w-[40px] h-[40px] rounded-full object-cover border border-border shadow-sm shrink-0"
                            />
                          ) : (
                            <div className="w-[40px] h-[40px] rounded-full bg-transparent flex items-center justify-center font-medium text-muted-foreground text-xl shrink-0">
                              {r.display_name?.charAt(0) || "?"}
                            </div>
                          )}
                          <div className="font-medium text-sm text-foreground leading-tight max-w-[160px]">
                            {r.display_name || "Sem Nome"}
                          </div>
                        </div>
                      </Td>

                      {/* TELEFONES */}
                      <Td>
                        <div
                          className={`flex flex-col gap-1 py-1 transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                        >
                          {rPhones.length > 0 ? (
                            rPhones.map((p) => (
                              <div
                                key={p.id}
                                className="text-[13px] whitespace-nowrap"
                              >
                                <span className="font-medium text-muted-foreground">
                                  {p.label?.endsWith(":")
                                    ? p.label
                                    : `${p.label}:`}{" "}
                                </span>
                                <span className="text-foreground/90">
                                  {displayPhone(p.value)}
                                </span>
                              </div>
                            ))
                          ) : (
                            <span className="italic text-muted-foreground text-xs">
                              Sem telefone
                            </span>
                          )}
                        </div>
                      </Td>

                      {/* EMAILS */}
                      <Td>
                        <div
                          className={`flex flex-col gap-1 py-1 transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                        >
                          {rEmails.length > 0 ? (
                            rEmails.map((e) => (
                              <div
                                key={e.id}
                                className="text-[13px] truncate max-w-[240px]"
                              >
                                <span className="font-medium text-muted-foreground">
                                  {e.label}:{" "}
                                </span>
                                <span className="text-sky-500">{e.value}</span>
                              </div>
                            ))
                          ) : (
                            <span className="italic text-muted-foreground text-xs">
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
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-muted text-[10px] font-medium tracking-tight shadow-sm text-muted-foreground"
                                >
                                  {l}
                                </span>
                              ))
                          ) : (
                            <span className="text-muted-foreground/60 text-xs italic">
                              —
                            </span>
                          )}
                        </div>
                      </Td>

                      <Td align="right">
                        <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 relative">
                          <div
                            className="relative"
                            ref={msgMenuForId === r.id ? msgMenuTriggerRef : undefined}
                          >
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
                            <Dropdown
                              open={msgMenuForId === r.id}
                              onClose={() => setMsgMenuForId(null)}
                              triggerRef={msgMenuTriggerRef}
                            >
                              <div onClick={(e) => e.stopPropagation()}>
                                {rPhones.map((p) => (
                                  <MenuItem
                                    key={p.id}
                                    icon={<IconSend />}
                                    label={`Para: ${p.label} · ${displayPhone(p.value)}`}

                                    onClick={() => {
                                      setMsgMenuForId(null);
                                      setShowSendNow({
                                        open: true,
                                        contactId: r.id,
                                        phone: p.value,
                                      });
                                    }}
                                  />
                                ))}
                              </div>
                            </Dropdown>
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
            <Pagination
              page={safePage}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              pageSizeOptions={[30, 50, 100, 200, 500]}
            />
            <div className="h-8 md:h-6" />
          </div>
        </div>
      )}

      {/* ── MODAL WHATSAPP ───────────────────────────────────────────────── */}
      {showSendNow.open && showSendNow.contactId && showSendNow.phone && (
        <EnviarMensagemModal
          contactId={showSendNow.contactId}
          phone={showSendNow.phone}
          tenantId={tenantId}
          sessionOptions={sessionOptions}
          selectedSessionNow={selectedSessionNow}
          setSelectedSessionNow={setSelectedSessionNow}
          addToast={addToast}
          onClose={() =>
            setShowSendNow({ open: false, contactId: null, phone: null })
          }
        />
      )}

      {/* ── MODAL CRIAR / EDITAR ─────────────────────────────────────────── */}
      {editModal.open && (
        <EditContatoModal
          contact={editModal.contact}
          tenantId={tenantId}
          uniqueLabels={uniqueLabels}
          addToast={addToast}
          onClose={() => setEditModal({ open: false, contact: null })}
          onSuccess={() => {
            setEditModal({ open: false, contact: null });
            loadData();
          }}
          onDataChanged={loadData}
        />
      )}

      {/* ── MODAL EXCLUSÃO ───────────────────────────────────────────────── */}
      {deleteModal.open && deleteModal.contact && (
        <ExcluirContatoModal
          contact={deleteModal.contact}
          addToast={addToast}
          onClose={() => setDeleteModal({ open: false, contact: null })}
          onSuccess={() => {
            setDeleteModal({ open: false, contact: null });
            loadData();
          }}
        />
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
        <div className="p-12 text-center text-muted-foreground animate-pulse">
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
      className="px-3 py-2 cursor-pointer select-none group hover:text-emerald-500 transition-colors text-left"
    >
      <div className="flex items-center gap-1">
        {label}{" "}
        <span
          className={`transition-opacity ${active ? "opacity-100 text-emerald-500" : "opacity-40 group-hover:opacity-70"}`}
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
      <span className="font-medium uppercase text-xs tracking-wide">
        {label}
      </span>
      <span
        className={`transition-opacity flex items-center ${active ? "opacity-100 text-emerald-400" : "opacity-30"}`}
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
    blue: "text-sky-500 bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/20",
    green:
      "text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20",
    amber:
      "text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
    purple:
      "text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20",
    red: "text-rose-500 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
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
      className="group w-full px-4 py-2.5 flex items-center gap-3 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400 transition-all text-left text-sm font-medium tracking-tight rounded-lg"
    >
      <span className="opacity-70 group-hover:scale-110 transition-transform">
        {icon}
      </span>
      {label}
    </button>
  );
}

// ✅ Modal, IconSend e IconTrash agora vivem em ./shared (usados também
// pelos modais extraídos). Os ícones abaixo continuam aqui — só a lista
// principal usa.
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
function IconEdit() {
  return <Pencil className="w-4 h-4" />;
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
