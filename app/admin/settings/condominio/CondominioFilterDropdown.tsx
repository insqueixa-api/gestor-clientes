"use client";
// app/admin/settings/condominio/CondominioFilterDropdown.tsx
// Seletor de condomínio usado como filtro no topo da página de Ações —
// junta em um só lugar: escolher o condomínio ativo, editar rapidamente
// (lápis por linha) e adicionar um novo (última linha do dropdown).
import { useEffect, useRef, useState } from "react";
import { Building2, ChevronDown, Pencil, Plus } from "lucide-react";
import type { CondominioRow } from "./shared";

export default function CondominioFilterDropdown({
  condominios,
  selectedId,
  onSelect,
  onEdit,
  onAddNew,
}: {
  condominios: CondominioRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (item: CondominioRow) => void;
  onAddNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selected = condominios.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-10 px-3 flex items-center gap-2 bg-transparent border border-border rounded-lg text-sm text-foreground/90 hover:border-emerald-500/50 transition-colors min-w-[200px]"
      >
        {selected?.logo_url ? (
          <img
            src={selected.logo_url}
            alt={selected.nome}
            className="w-5 h-5 rounded object-cover shrink-0"
          />
        ) : (
          <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <span className="flex-1 text-left truncate">
          {selected?.nome || "Selecionar condomínio"}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1.5 w-72 max-h-80 overflow-y-auto overscroll-contain custom-scrollbar rounded-xl border border-border bg-card shadow-2xl p-1.5"
          style={{ maxHeight: "min(20rem, calc(100dvh - 120px))" }}
        >
          {condominios.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              Nenhum condomínio cadastrado ainda.
            </div>
          )}
          {condominios.map((c) => (
            <div
              key={c.id}
              className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                c.id === selectedId
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "hover:bg-muted text-foreground/90"
              }`}
              onClick={() => {
                onSelect(c.id);
                setOpen(false);
              }}
            >
              {c.logo_url ? (
                <img
                  src={c.logo_url}
                  alt={c.nome}
                  className="w-6 h-6 rounded object-cover shrink-0"
                />
              ) : (
                <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <span className="flex-1 min-w-0 truncate text-sm">{c.nome}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onEdit(c);
                }}
                className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
                title="Editar condomínio"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          <div className="my-1.5 h-px bg-border mx-1" />

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onAddNew();
            }}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-emerald-500 hover:bg-emerald-500/10 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Adicionar novo condomínio
          </button>
        </div>
      )}
    </div>
  );
}
