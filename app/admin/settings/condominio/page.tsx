"use client";
// app/admin/settings/condominio/page.tsx
// Lista de condomínios do tenant — fase 1 do módulo (só cadastro). Notícias,
// arquivamento e geração de PDF vêm em fases futuras.
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import dynamic from "next/dynamic";
import { Pencil, Trash2, Building2 } from "lucide-react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";

const ModalCondominio = dynamic(() => import("./ModalCondominio"), {
  ssr: false,
});

export type CondominioRow = {
  id: string;
  tenant_id: string;
  nome: string;
  logo_url: string | null;
  endereco: string | null;
  contato: string | null;
  gestao: string | null;
  slogan1: string | null;
  slogan2: string | null;
  cor_primaria: string | null;
  cor_secundaria: string | null;
  created_at: string;
};

function IconActionBtn({
  children,
  title,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  tone: "amber" | "red";
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const colors = {
    amber:
      "text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
    red: "text-rose-500 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${colors[tone]}`}
    >
      {children}
    </button>
  );
}

export default function CondominioPage() {
  const tenantId = useTenantId();
  const [loading, setLoading] = useState(true);
  const [condominios, setCondominios] = useState<CondominioRow[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CondominioRow | null>(null);

  const { confirm } = useConfirm();
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
    setLoading(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("condominios")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("nome");
      if (error) throw error;
      setCondominios(data || []);
    } catch (e: any) {
      addToast("error", "Erro ao carregar condomínios", e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCondominios();
  }, [tenantId]);

  function handleOpenNew() {
    setEditingItem(null);
    setIsModalOpen(true);
  }
  function handleOpenEdit(item: CondominioRow) {
    setEditingItem(item);
    setIsModalOpen(true);
  }

  async function handleDelete(item: CondominioRow) {
    const ok = await confirm({
      title: "Excluir condomínio?",
      subtitle: `Tem certeza que deseja excluir "${item.nome}"?`,
      tone: "rose",
      confirmText: "Excluir",
      cancelText: "Voltar",
      details: ["Essa ação não pode ser desfeita."],
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser
        .from("condominios")
        .delete()
        .eq("id", item.id);
      if (error) throw error;
      addToast("success", "Condomínio excluído", item.nome);
      fetchCondominios();
    } catch (e: any) {
      addToast("error", "Erro ao excluir", e.message);
    }
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-3 sm:px-6 min-h-screen bg-background transition-colors">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
          🏢 Condomínio
        </h1>
        <button
          onClick={handleOpenNew}
          className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
        >
          <span>+</span> Adicionar Condomínio
        </button>
      </div>

      {loading && (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-xl border border-border">
          Carregando condomínios...
        </div>
      )}

      {!loading && condominios.length === 0 && (
        <div className="p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
          Nenhum condomínio cadastrado ainda.
        </div>
      )}

      {!loading && condominios.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-5">
          {condominios.map((item) => (
            <div
              key={item.id}
              className="rounded-xl overflow-hidden shadow-sm border border-border hover:border-emerald-500/30 bg-card transition-all"
            >
              <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-border">
                <div className="flex items-center gap-3 min-w-0">
                  {item.logo_url ? (
                    <img
                      src={item.logo_url}
                      alt={item.nome}
                      className="w-9 h-9 rounded-lg object-cover border border-border shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-transparent border border-border flex items-center justify-center shrink-0 text-muted-foreground">
                      <Building2 className="w-4 h-4" />
                    </div>
                  )}
                  <h2
                    className="text-sm font-medium truncate text-foreground/90 tracking-tight"
                    title={item.nome}
                  >
                    {item.nome}
                  </h2>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <IconActionBtn
                    title="Editar"
                    tone="amber"
                    onClick={() => handleOpenEdit(item)}
                  >
                    <Pencil className="w-4 h-4" />
                  </IconActionBtn>
                  <IconActionBtn
                    title="Excluir"
                    tone="red"
                    onClick={() => handleDelete(item)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </IconActionBtn>
                </div>
              </div>
              {(item.endereco || item.gestao) && (
                <div className="px-4 py-3 space-y-1 text-xs text-muted-foreground">
                  {item.endereco && <p className="truncate">📍 {item.endereco}</p>}
                  {item.gestao && <p className="truncate">🧑‍💼 {item.gestao}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <ModalCondominio
          condominio={editingItem}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false);
            addToast(
              "success",
              editingItem ? "Condomínio atualizado" : "Condomínio criado",
              editingItem?.nome,
            );
            fetchCondominios();
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
