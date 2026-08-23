"use client";
// app/admin/settings/condominio/page.tsx
// Página de Ações (notícias) por condomínio — busca + filtro de status +
// seletor de condomínio (com adicionar/editar embutidos, lembra o último
// usado) + grid de Ações do condomínio selecionado. Montar Edições/gerar
// PDF fica em ./edicoes (link no topo).
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Pencil, Archive, ArchiveRestore, Images, Newspaper } from "lucide-react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import CondominioFilterDropdown from "./CondominioFilterDropdown";
import {
  LOCALSTORAGE_KEY,
  STATUS_COR,
  type CondominioRow,
  type StatusAcao,
  type AcaoRow,
} from "./shared";

const ModalCondominio = dynamic(() => import("./ModalCondominio"), {
  ssr: false,
});
const ModalAcao = dynamic(() => import("./ModalAcao"), { ssr: false });

const STATUS_FILTROS: { valor: StatusAcao | "Todos"; label: string }[] = [
  { valor: "Todos", label: "Todos" },
  { valor: "futuro", label: "Futuro" },
  { valor: "planejado", label: "Planejado" },
  { valor: "em_andamento", label: "Em andamento" },
  { valor: "pausado", label: "Pausado" },
  { valor: "concluido", label: "Concluído" },
];

export default function CondominioPage() {
  const tenantId = useTenantId();

  const [condominios, setCondominios] = useState<CondominioRow[]>([]);
  const [loadingCondominios, setLoadingCondominios] = useState(true);
  const [selectedCondominioId, setSelectedCondominioId] = useState<string | null>(
    null,
  );

  const [acoes, setAcoes] = useState<AcaoRow[]>([]);
  const [loadingAcoes, setLoadingAcoes] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusAcao | "Todos">(
    "Todos",
  );
  const [showArchived, setShowArchived] = useState(false);

  const [isModalCondominioOpen, setIsModalCondominioOpen] = useState(false);
  const [editingCondominio, setEditingCondominio] =
    useState<CondominioRow | null>(null);

  const [isModalAcaoOpen, setIsModalAcaoOpen] = useState(false);
  const [editingAcao, setEditingAcao] = useState<AcaoRow | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 5000);
  }
  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function fetchCondominios() {
    if (!tenantId) return;
    setLoadingCondominios(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("condominios")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("nome");
      if (error) throw error;
      const rows = data || [];
      setCondominios(rows);

      // ✅ pré-seleciona o último condomínio usado (localStorage) — só na
      // primeira carga, sem sobrescrever uma seleção manual já feita nesta
      // sessão.
      setSelectedCondominioId((current) => {
        if (current && rows.some((c) => c.id === current)) return current;
        const salvo =
          typeof window !== "undefined"
            ? localStorage.getItem(LOCALSTORAGE_KEY)
            : null;
        if (salvo && rows.some((c) => c.id === salvo)) return salvo;
        return rows[0]?.id ?? null;
      });
    } catch (e: any) {
      addToast("error", "Erro ao carregar condomínios", e.message);
    } finally {
      setLoadingCondominios(false);
    }
  }

  useEffect(() => {
    fetchCondominios();
  }, [tenantId]);

  async function fetchAcoes() {
    if (!tenantId || !selectedCondominioId) {
      setAcoes([]);
      setLoadingAcoes(false);
      return;
    }
    setLoadingAcoes(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("condominio_acoes")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("condominio_id", selectedCondominioId)
        .eq("arquivada", showArchived)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAcoes(data || []);
    } catch (e: any) {
      addToast("error", "Erro ao carregar ações", e.message);
    } finally {
      setLoadingAcoes(false);
    }
  }

  useEffect(() => {
    fetchAcoes();
  }, [tenantId, selectedCondominioId, showArchived]);

  function handleSelectCondominio(id: string) {
    setSelectedCondominioId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCALSTORAGE_KEY, id);
    }
  }

  async function handleToggleArquivar(item: AcaoRow) {
    try {
      const { error } = await supabaseBrowser
        .from("condominio_acoes")
        .update({ arquivada: !item.arquivada })
        .eq("id", item.id);
      if (error) throw error;
      addToast(
        "success",
        item.arquivada ? "Ação restaurada" : "Ação arquivada",
        item.titulo,
      );
      fetchAcoes();
    } catch (e: any) {
      addToast("error", "Erro", e.message);
    }
  }

  const selectedCondominio = condominios.find(
    (c) => c.id === selectedCondominioId,
  );

  const acoesFiltradas = acoes.filter((a) => {
    if (statusFilter !== "Todos" && a.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (
        !a.titulo.toLowerCase().includes(q) &&
        !(a.texto || "").toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 pt-0 pb-6 px-3 sm:px-6 min-h-screen bg-background transition-colors">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
          🏢 Condomínio
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/settings/condominio/edicoes"
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg border border-border text-foreground/80 hover:bg-muted font-medium text-xs md:text-sm flex items-center gap-2 transition-all"
          >
            <Newspaper className="w-4 h-4" /> Edições
          </Link>
          <button
            onClick={() => {
              setEditingAcao(null);
              setIsModalAcaoOpen(true);
            }}
            disabled={!selectedCondominioId}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-50"
          >
            <span>+</span> Nova Ação
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[180px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar ações por título ou texto..."
            className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusAcao | "Todos")}
          className="h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50"
        >
          {STATUS_FILTROS.map((s) => (
            <option key={s.valor} value={s.valor}>
              {s.label}
            </option>
          ))}
        </select>

        <CondominioFilterDropdown
          condominios={condominios}
          selectedId={selectedCondominioId}
          onSelect={handleSelectCondominio}
          onEdit={(item) => {
            setEditingCondominio(item);
            setIsModalCondominioOpen(true);
          }}
          onAddNew={() => {
            setEditingCondominio(null);
            setIsModalCondominioOpen(true);
          }}
        />

        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`h-10 px-3 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
            showArchived
              ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
              : "border-border bg-transparent text-muted-foreground"
          }`}
        >
          {showArchived ? "🗄 Vendo arquivadas" : "🗄 Ver arquivadas"}
        </button>
      </div>

      {!loadingCondominios && condominios.length === 0 && (
        <div className="p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
          Nenhum condomínio cadastrado ainda — use o filtro acima para
          adicionar o primeiro.
        </div>
      )}

      {selectedCondominioId && loadingAcoes && (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-xl border border-border">
          Carregando ações...
        </div>
      )}

      {selectedCondominioId && !loadingAcoes && acoesFiltradas.length === 0 && (
        <div className="p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
          {showArchived
            ? "Nenhuma ação arquivada."
            : "Nenhuma ação encontrada para este condomínio."}
        </div>
      )}

      {selectedCondominioId && !loadingAcoes && acoesFiltradas.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-5">
          {acoesFiltradas.map((item) => {
            const cor = STATUS_COR[item.status];
            const capa = item.fotos?.[0];
            return (
              <div
                key={item.id}
                className={`rounded-xl overflow-hidden shadow-sm border bg-card transition-all ${
                  item.arquivada
                    ? "border-amber-500/30 opacity-75"
                    : "border-border hover:border-emerald-500/30"
                }`}
              >
                {capa && (
                  <img
                    src={capa.url}
                    alt={item.titulo}
                    className="w-full h-36 object-cover"
                  />
                )}
                <div className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2
                      className="text-sm font-medium text-foreground/90 tracking-tight line-clamp-2"
                      title={item.titulo}
                    >
                      {item.titulo}
                    </h2>
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        title="Editar"
                        onClick={() => {
                          setEditingAcao(item);
                          setIsModalAcaoOpen(true);
                        }}
                        className="w-7 h-7 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 flex items-center justify-center transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title={item.arquivada ? "Restaurar" : "Arquivar"}
                        onClick={() => handleToggleArquivar(item)}
                        className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                          item.arquivada
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                            : "border-rose-500/20 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                        }`}
                      >
                        {item.arquivada ? (
                          <ArchiveRestore className="w-3.5 h-3.5" />
                        ) : (
                          <Archive className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${cor.bg} ${cor.text} ${cor.border}`}
                    >
                      {cor.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground capitalize">
                      {item.categoria}
                    </span>
                    {item.fotos?.length > 1 && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Images className="w-3 h-3" /> {item.fotos.length}
                      </span>
                    )}
                  </div>

                  {item.texto && (
                    <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                      {item.texto}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isModalCondominioOpen && (
        <ModalCondominio
          condominio={editingCondominio}
          onClose={() => setIsModalCondominioOpen(false)}
          onSuccess={() => {
            setIsModalCondominioOpen(false);
            addToast(
              "success",
              editingCondominio ? "Condomínio atualizado" : "Condomínio criado",
              editingCondominio?.nome,
            );
            fetchCondominios();
          }}
          onError={(msg) => addToast("error", "Erro ao salvar", msg)}
        />
      )}

      {isModalAcaoOpen && selectedCondominioId && (
        <ModalAcao
          acao={editingAcao}
          condominioId={selectedCondominioId}
          condominioNome={selectedCondominio?.nome || ""}
          onClose={() => setIsModalAcaoOpen(false)}
          onSuccess={() => {
            setIsModalAcaoOpen(false);
            addToast(
              "success",
              editingAcao ? "Ação atualizada" : "Ação criada",
              editingAcao?.titulo,
            );
            fetchAcoes();
          }}
          onError={(msg) => addToast("error", "Erro ao salvar", msg)}
        />
      )}

      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}
